# 普通动画片段如何转成可叠加动作：`makeClipAdditive` 参考帧机制源码分析

分析基于本仓库源码，核心入口是 `src/animation/AnimationUtils.js` 中的
`makeClipAdditive( targetClip, referenceFrame = 0, referenceClip = targetClip, fps = 30 )`
（`AnimationUtils.js:263-389`，静态方法包装在 `:508-512`）。

它把"普通片段"（每一帧记录属性的**绝对值**）改写成"叠加片段"（每一帧只记录相对于某一
参考姿态的**差值**），并把 `targetClip.blendMode` 置为 `AdditiveAnimationBlendMode`
（`AnimationUtils.js:385`）。参考姿态不是来自目标片段自身的某个固定姿势，而是对
**另一段片段 `referenceClip` 在另一采样时刻 `referenceFrame / fps` 进行采样**得到的——
这正是题目所说"参考姿态来自另一段采样时刻不同的动画"。

涉及的源码文件：

| 文件 | 作用 |
| --- | --- |
| `src/animation/AnimationUtils.js` | 参考帧取值、逐轨相减/旋转、标记叠加模式 |
| `src/animation/KeyframeTrack.js` | 轨道存储；Bezier 切线存放在独立的 `settings` 中 |
| `examples/jsm/loaders/GLTFLoader.js` | glTF CUBICSPLINE 轨道：切线与值打包在 `values` 里（`:2181-2265`、`:4787-4804`） |
| `src/math/Quaternion.js` | 共轭、`multiplyQuaternionsFlat`、`slerpFlat` |
| `src/animation/PropertyMixer.js` | 播放期叠加累积（加法 / 四元数乘法、单位元） |
| `src/animation/AnimationAction.js` | 按 `blendMode` 分流到 `accumulateAdditive`（`:612-635`） |
| `test/unit/addons/loaders/GLTFLoader.tests.js` | 官方可复算样例（`:153-186`） |

---

## 1. 可复算片段：参考帧在各轨上对应什么值，转换后如何还原表情

### 1.1 参考帧 → 参考时间 → 每轨参考值

```js
const referenceTime = referenceFrame / fps;        // AnimationUtils.js:268
if ( fps <= 0 ) fps = 30;                          // AnimationUtils.js:265
```

`referenceFrame` 是**帧号**，要除以 `fps` 才是轨道时间轴上的秒数。之后对参考片段的
**每条轨道独立**求该时刻的参考值，分三种情况（`AnimationUtils.js:311-336`）：

1. `referenceTime <= times[0]`：参考时刻不早于首帧——直接取**第一个关键帧的值**；
2. `referenceTime >= times[last]`：不晚于末帧——直接取**最后一个关键帧的值**；
3. 落在两帧之间——用该轨道自己的插值器 `referenceTrack.createInterpolant().evaluate( referenceTime )`
   **插值**出参考值。注意不同轨道类型用的插值器不同（向量用线性、四元数用 SLERP、
   CUBICSPLINE 用三次样条），所以参考值本身就反映了该轨的曲线形状。

对 CUBICSPLINE 轨道，`values` 里每个关键帧存了三块
`[inTangent, splineVertex, outTangent]`，取关键帧时用 `referenceOffset = valueSize / 3`
跳过切线块，只切出中间的 `splineVertex`（`AnimationUtils.js:292-296、318-327`）；
走插值分支时，glTF 插值器的 `resultBuffer` 本来就只输出顶点值，天然不含切线。

拿到参考值后按轨道类型分两种数学处理（`AnimationUtils.js:338-379`）：

- **四元数轨（旋转）**：把参考四元数归一化后取**共轭** `q_ref* = q_ref^{-1}`
  （单位四元数共轭即逆，`AnimationUtils.js:339-344`，`Quaternion.conjugate` 见
  `Quaternion.js:571-581`）。然后对目标轨每个四元数块做
  `q_add = q_ref* · q_target`（`multiplyQuaternionsFlat(target, refConj, target)`，
  `AnimationUtils.js:351-366`）。
- **其它数值轨（平移、缩放、权重等）**：直接做分量减法
  `v_add = v_target − v_ref`（`AnimationUtils.js:368-378`）。

### 1.2 可复算样例 A：平移轨（取自官方单元测试）

数据与 `test/unit/addons/loaders/GLTFLoader.tests.js:153-186` 完全一致。一条 glTF
CUBICSPLINE 的 `translation` 轨，两个关键帧在 `t = 0` 和 `t = 1` 秒，每个关键帧 9 个数
（3 个入切线 + 3 个顶点 + 3 个出切线）：

```
t=0:  in=[0,0,0]  v0=[1,2,3]  out=[0,0,0]
t=1:  in=[0,0,0]  v1=[3,4,5]  out=[0,0,0]
```

调用 `makeClipAdditive( clip, 15, clip, 30 )`（这里参考片段与目标片段是同一条，
但时刻取在第 15 帧）：

**第一步，参考时间**：`referenceTime = 15 / 30 = 0.5 s`，落在两帧之间，走插值分支。
样条在中点 `p = 0.5`，且所有切线为 0，Hermite 基函数系数
`s0 = s2 = 0.5、s1 = s3 = 0`（见 `GLTFLoader.js:2220-2241`），于是每个分量：

```
v_ref = 0.5·v0 + 0.5·v1 = [2, 3, 4]
```

**第二步，逐关键帧做减法**。CUBICSPLINE 数值轨的 `targetOffset = valueSize/3 = 3`，
循环只减中间的顶点块，前后两个切线块原样保留（`AnimationUtils.js:370-377`）：

| 存储块 | 转换前 | 减法 | 转换后 |
| --- | --- | --- | --- |
| 帧0 inTangent | `[0,0,0]` | 不动（切线块） | `[0,0,0]` |
| 帧0 vertex | `[1,2,3]` | −`[2,3,4]` | `[-1,-1,-1]` |
| 帧0 outTangent | `[0,0,0]` | 不动 | `[0,0,0]` |
| 帧1 inTangent | `[0,0,0]` | 不动 | `[0,0,0]` |
| 帧1 vertex | `[3,4,5]` | −`[2,3,4]` | `[1,1,1]` |
| 帧1 outTangent | `[0,0,0]` | 不动 | `[0,0,0]` |

展平后的 `values` 与官方断言逐元素相等（已用独立脚本复算通过）：

```
[0,0,0, -1,-1,-1, 0,0,0,  0,0,0, 1,1,1, 0,0,0]
```

**第三步，还原这一帧附近的表情（平移部分）**。叠加播放时数值轨走
`PropertyMixer._lerpAdditive`：`基底 += 叠加值 × weight`（`PropertyMixer.js:370-380`）。
若基底姿态正好是参考姿态 `[2,3,4]`、权重为 1：

```
帧0: [2,3,4] + [-1,-1,-1] = [1,2,3]  ✓ 还原原顶点 v0
帧1: [2,3,4] + [ 1, 1, 1] = [3,4,5]  ✓ 还原原顶点 v1
```

并且在参考时刻 `t = 0.5` 对转换后的轨再采样，结果是 `[0,0,0]`——数值叠加的**单位元
是零向量**（`_setAdditiveIdentityNumeric`，`PropertyMixer.js:288-299`），即叠加层在
参考时刻"什么都不做"，角色只剩基底姿态。这就是"参考帧附近的表情被还原"的含义：
参考时刻差值为 0，向两侧偏离参考姿态的量就是原动画相对该姿态的位移。

### 1.3 可复算样例 B：旋转轨（参考姿态来自另一片段、另一时刻）

设目标片段有一条普通四元数轨（非 CUBICSPLINE，无切线），绕 Y 轴旋转：

```
t=0: q0 = R(Y, +30°) = [0, 0.5, 0, 0.8660]
t=1: q1 = R(Y, +90°) = [0, 0.7071, 0, 0.7071]
```

参考片段是**另一段动画**（此处用相同关键帧便于复算），取第 30 帧、30 fps，即
`referenceTime = 1 s`，命中末帧分支，参考值 `q_ref = q1`。转换：

```
q_ref* = conj(q1) = R(Y, −90°)
帧0:   q_add0 = q_ref* · q0 = R(Y,−90°) · R(Y,+30°) = R(Y,−60°)
             = [0, −0.5, 0, 0.8660]
帧1:   q_add1 = q_ref* · q1 = 单位四元数 [0,0,0,1]
```

以上数值已用脚本按源码路径实跑确认（浮点误差 < 1e-5）。

**还原（播放期）**：四元数叠加不是加法而是乘法。`PropertyMixer._slerpAdditive`
先算 `work = q_accu · q_incoming`，再向 `work` 做 SLERP（`PropertyMixer.js:344-354`）；
权重为 1 时等价于 `q_accu ← q_accu · q_incoming`，单位元是 `[0,0,0,1]`
（`_setAdditiveIdentityQuaternion`，`PropertyMixer.js:301-306`）。基底为参考姿态时：

```
帧0: q_ref · q_add0 = R(Y,+90°) · R(Y,−60°) = R(Y,+30°) = q0 ✓
帧1: q_ref · q_add1 = q1 · 1 = q1 ✓
```

旋转的"零表情"是单位四元数：在参考时刻叠加层不产生任何转动。由于转换用的是
`q_ref* · q` 而播放用的是 `q_ref · q_add`，共轭在乘法中精确抵消，这是旋转能无损
还原的代数原因（前提是参考四元数为单位四元数；源码在取共轭前先 `normalize()`）。

### 1.4 轨道匹配与跳过规则

- 循环以**参考片段的轨道**为准，再在目标片段里按 `name + ValueTypeName` 完全相同
  查找对应轨（`AnimationUtils.js:271-287`）；找不到就跳过该轨。
- `bool` 和 `string` 类型直接 `continue`，不做任何转换（`AnimationUtils.js:276-277`）。
- 无论跳过多少轨，函数结尾都会把整个 `targetClip.blendMode` 标记为叠加模式。

---

## 2. 带切线的关键帧：转换前后关键值与切线各表示什么

three.js 里"带切线"有两套互不相同的存储方式，转换时的待遇也不同。

### 2.1 glTF CUBICSPLINE：切线与值打包在 `values` 中

存储布局（`GLTFLoader.js:2232-2233`）：

```
[ inTangent_k, splineVertex_k, outTangent_k,  inTangent_k+1, splineVertex_k+1, ... ]
```

- **关键值 `splineVertex`**：关键帧时刻属性的实际取值（平移分量或旋转四元数）。
- **入/出切线**：glTF 规定的是**时间归一化导数**，插值时还要乘帧间隔 `td = t1−t0`
  （`m0 = outTangent·td`、`m1 = inTangent·td`，`GLTFLoader.js:2237-2239`），即切线
  控制的是离开/抵达该关键帧时曲线的速率与方向。

转换时分轨道类型：

**数值类 CUBICSPLINE（平移/缩放/权重）**：`targetOffset = valueSize/3`，相减循环
只覆盖中间顶点块（`valueEnd = valueSize − 2·offset`，`AnimationUtils.js:370-377`），
**两个切线块原样保留**。原因写在源码注释里（`AnimationUtils.js:303-305`）：
减去一个常量不改变数值曲线的切线——`d(v − c)/dt = dv/dt`。1.2 节的样例里六个
`[0,0,0]` 切线转换后全部不变，正是此规则。

**四元数 CUBICSPLINE**：四元数分支没有 offset 概念，循环按步长 4 遍历**整个
`values` 缓冲**（`AnimationUtils.js:351-366`），也就是说每个关键帧的 3 个四元数块
——入切线、顶点、出切线——**统统左乘 `q_ref*` 被旋转到参考姿态的局部坐标系**。
源码注释明确解释：减常量不影响数值切线，但从四元数轨中移除一个旋转时，必须把
切线一起旋转，否则切线表达的角速度方向还停留在世界坐标系里。实测（非单位、非零
切线四元数）确认 6 个块全部满足 `block_add = q_ref* · block_orig`，且可由
`q_ref · block_add` 精确还原。转换后各块的含义：

- 顶点块：相对参考姿态的**相对旋转**（参考帧处为单位四元数）；
- 切线块：参考姿态局部坐标系下的**相对角速度方向/速率**，而不再是世界系下的绝对
  角速度。播放时随 `q_ref ·` 一起被转回世界系，曲线形状与原动画一致。

### 2.2 Bezier 切线（COLLADA/Maya 风格）：切线在 `settings` 中，不受转换影响

`InterpolateBezier` 轨道的切线不放在 `values` 里，而在
`track.settings.inTangents / outTangents`，是按 `[time, value]` 成对排列的 2D 控制点
（`KeyframeTrack.js:155-179`、`BezierInterpolant.js:10-17、50-66`）。
`makeClipAdditive` 只读写 `track.times / track.values`，**完全不触碰 `settings`**，
因此：

- 转换前：切线是值随时间变化的贝塞尔控制点（含时间分量与值分量）；
- 转换后：关键值被减去参考常量，但切线数组保持原数据。对数值轨这与
  "平移曲线不改斜率"一致，曲线形状平移后仍然正确；
- 这类轨道没有 `isInterpolantFactoryMethodGLTFCubicSpline` 标记，`offset` 恒为 0，
  按普通数值轨处理。

### 2.3 哪些轨道保留原数据（汇总）

| 轨道情形 | 关键值 | 切线 | 依据 |
| --- | --- | --- | --- |
| `bool` / `string` 轨 | 原样保留 | 无切线概念 | `AnimationUtils.js:276-277` |
| 目标片段中找不到同名同类型轨的参考轨 | 目标轨原样保留 | — | `AnimationUtils.js:280-287` |
| 数值 CUBICSPLINE | 顶点减参考值 | **in/out 切线原样保留** | `:370-377` |
| 四元数 CUBICSPLINE | 顶点左乘共轭参考四元数 | **切线同步左乘共轭（被旋转，不保留原值）** | `:351-366` |
| 普通数值轨（linear/smooth/bezier） | 全部关键值减参考值 | Bezier 的 `settings` 切线数组原样保留 | `:368-378` |
| 普通四元数轨 | 全部关键帧左乘共轭参考四元数 | 无打包切线 | `:351-366` |
| `times` 时间数组 | 所有轨道均不变 | — | 函数只读不写 `times` |

另外注意两个边界行为：参考时刻落在首尾帧之外时**不外推**，而是钳制取首/末关键帧
（`:315-327`）；`fps <= 0` 被强制改回 30（`:265`）。

### 2.4 叠加播放的适用条件

转换只负责改数据，真正"叠加"发生在混合器里，需要同时满足：

1. **以叠加模式播放**。`makeClipAdditive` 已把 `clip.blendMode` 置为
   `AdditiveAnimationBlendMode`；`mixer.clipAction` 默认继承该模式
   （`AnimationMixer.js:569-581`），`AnimationAction._update` 据此走
   `accumulateAdditive` 而不是普通 `accumulate`（`AnimationAction.js:612-635`）。
   也可以在 `clipAction(clip, root, AdditiveAnimationBlendMode)` 显式指定。
2. **需要一个基底姿态承接**。叠加层的单位元是 0（数值）/ 单位四元数（旋转），
   它本身不定义绝对姿势，只定义"在基底上改多少"。基底可以是另一个普通（Normal）
   动作，也可以是对象当前状态：`PropertyMixer.saveOriginalState()` 会缓存属性原值，
   普通层权重不足 1 时用原值补齐（`PropertyMixer.js:212-221、250-274`），随后
   `apply()` 再把叠加累积量合进去（`:223-229`）。官方示例
   `examples/webgl_animation_skinning_additive_blending.html:133-148` 就是先
   `makeClipAdditive(clip)` 再与基础动作同 mixer 播放；对 `_pose` 片段还用
   `subclip` 只取第 2-3 帧做成静态姿势叠加层。
3. **轨道类型必须是数值型**。旋转用单位四元数、其它数值用零向量作为叠加单位元；
   `bool/string` 轨不参与数值化转换，播放期走 `_select` 门控，叠加对它们没有实际
   意义（`PropertyMixer.js:62-73、308-319、324-336`）。
4. **参考姿态与播放基底一致时才能精确还原原动画**。转换期减去的（或共轭掉的）是
   `referenceClip` 在 `referenceFrame` 的采样值；播放期只有当基底恰好是该姿态、
   权重为 1 时，`v_base + v_add` / `q_base · q_add` 才严格还原原关键帧。基底不同
   时，叠加层表达的是"同一组相对变化量作用在新基底上"——这正是叠加动画的用途
   （例如把同一段表情增量叠到不同角色姿势上），但不应期待还原出原片段的绝对值。
5. **多条叠加层可同时生效**：`cumulativeWeightAdditive` 逐条累加（
   `PropertyMixer.js:172-191`），数值层线性相加、旋转层依次左乘；权重为 0 的层
   贡献单位元，不改变结果。
