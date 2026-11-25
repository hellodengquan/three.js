# LOD 三档：切换距离、滞回比例，以及"绘制档 ≠ 拾取档"的边界

> 结论先行：**不一定同一档。**
> 只要 `camera.zoom !== 1`，"画出来的"和"射线选中的"就会在一个**可精确计算**的距离区间内
> 分离；即使 `zoom === 1`，只要拾取发生在"相机已动、尚未重绘"的窗口里，或者对 LOD 做了
> 递归拾取、或者用正交相机且光标偏离中心，两者也会分离。
>
> 本文的行号对应本仓库当前提交（`src/objects/LOD.js` 331 行，three r187）。
> 文中每个数字都用 Node 直接 `import src/` 模块实算过，复现脚本见 §7。

---

## 1. 源码事实

### 1.1 绘制路径：`LOD.update(camera)`

渲染器在**每帧遍历场景时**调用它：

```js
// src/renderers/WebGLRenderer.js:1878-1890
if ( object.visible === false ) return;                   // 1878：整枝跳过
const visible = object.layers.test( camera.layers );      // 1880
if ( visible ) {
  ...
  } else if ( object.isLOD ) {
    if ( object.autoUpdate === true ) object.update( camera );   // 1890
```

`update` 的核心（`src/objects/LOD.js:252-300`）：

```js
_v1.setFromMatrixPosition( camera.matrixWorld );
_v2.setFromMatrixPosition( this.matrixWorld );
const distance = _v1.distanceTo( _v2 ) / camera.zoom;     // :261  ← 除以 zoom
levels[ 0 ].object.visible = true;                        // :263
for ( i = 1, l = levels.length; i < l; i ++ ) {
  let levelDistance = levels[ i ].distance;
  if ( levels[ i ].object.visible ) {                     // :271 读"本帧循环开始前"的标志
    levelDistance -= levelDistance * levels[ i ].hysteresis;       // :273
  }
  if ( distance >= levelDistance ) {                      // :277 含等号
    levels[ i - 1 ].object.visible = false;
    levels[ i ].object.visible = true;
  } else break;
}
this._currentLevel = i - 1;                               // :290
for ( ; i < l; i ++ ) levels[ i ].object.visible = false;  // :292-296
```

要点：

1. **距离被除以 `zoom`**（`:261`）。`zoom` 同时进投影矩阵
   （`PerspectiveCamera.js:356`、`OrthographicCamera.js:196-200`），所以 `d/zoom` 是
   "等效距离"，用于让屏幕占比近似不变。
2. **阈值按"该档此刻是否可见"二选一**（`:271-275`）：
   - 可见 → `D_i (1 − h_i)`，记作 **`T_i`**（近阈值，提前降档）
   - 不可见 → `D_i`（远阈值，回到该档要更远）
   这就是滞回：进入用 `T_i`，退出用 `D_i`。
3. `hysteresis` 是**该档距离的比例**，不是绝对长度；`addLevel` 会对 `distance` 取绝对值
   并按 `distance` 插入排序（`:118`、`:124-134`）。第 0 档的 `h` 永远不参与判断
   （循环从 `i=1` 开始）。

### 1.2 拾取路径：`LOD.raycast` → `getObjectForDistance`

```js
// src/objects/LOD.js:230-244
raycast( raycaster, intersects ) {
  const levels = this.levels;
  if ( levels.length > 0 ) {
    _v1.setFromMatrixPosition( this.matrixWorld );
    const distance = raycaster.ray.origin.distanceTo( _v1 );   // :238  ← 不除 zoom
    this.getObjectForDistance( distance ).raycast( raycaster, intersects );  // :240
  }
}
```

```js
// src/objects/LOD.js:190-222
for ( i = 1, l = levels.length; i < l; i ++ ) {
  let levelDistance = levels[ i ].distance;
  if ( levels[ i ].object.visible ) {
    levelDistance -= levelDistance * levels[ i ].hysteresis;  // 与 update 同一公式
  }
  if ( distance < levelDistance ) break;                      // :208
}
return levels[ i - 1 ].object;
```

即：**拾取档位 = `getObjectForDistance(射线原点到 LOD 原点的距离)`**，用**当前**的
`visible` 标志，并且**完全不看 `camera.zoom`**。注意 `:240` 是**无条件**调用选中档的
`raycast`，**不检查该档的 `visible`**。

> 文档坑：`getObjectForDistance` 的 JSDoc（`:181-189`）和 `docs/pages/LOD.html.md:79`
> 都写"返回第一个大于给定距离的对象"，与实现不符。实现是"最后一个有效阈值 ≤ distance
> 的档"。以代码为准。

### 1.3 两条路径的差异清单

| 维度 | 绘制（`update`） | 拾取（`raycast`） |
|---|---|---|
| 距离 | `|camera − LOD| / zoom` | `|ray.origin − LOD|`，**无 zoom** |
| 何时读标志 | 每帧 `projectObject` 时 | 调用 `intersectObject` 的那一刻 |
| 标志来源 | 上一帧 `update` 的结果 | 同一份共享状态 |
| 是否看 `object.visible` | 看（`:1878`） | **不看**（`Raycaster` 全程无此判断） |
| 是否看 `layers` | `camera.layers`（`:1880`） | `raycaster.layers`（`Raycaster.js:250`） |
| 命中哪一档 | 所有 `visible===true` 的子节点 | 只挑**一个**档；但递归拾取会遍历全部 |
| 档对象不是 Mesh 时 | 正常绘制 | 非递归拾取 0 命中（`Group.raycast` 为空实现） |

`Raycaster.intersect()`（`src/core/Raycaster.js:246-262`）里**没有任何 `visible` 判断**，
只有 layers 与"`raycast` 返回 `false` 才剪枝"：

```js
let propagate = true;
if ( object.layers.test( raycaster.layers ) ) {
  const result = object.raycast( raycaster, intersects );
  if ( result === false ) propagate = false;
}
if ( propagate === true && recursive === true ) { /* 继续遍历 children */ }
```

`LOD.raycast` 无返回值，所以**永不剪枝**——这是 §5.3 的根源。

### 1.4 一个可直接用的定理

逐项对比 `update` 的循环与 `getObjectForDistance` 的循环：两者对每个 `i` 用**完全相同**的
阈值公式、**互补**的比较方向（`>=` 与 `<`），只差"最后保留哪个下标"。于是：

> **定理 1.** 对任意 `visible` 标志、任意 `h`，若在距离 `d` 上调用
> `getObjectForDistance(d)`，它返回的档**恰好等于**随后用同一相机在 `d` 上调用 `update`
> 之后可见的那一档。
>
> 换言之：**拾取用的档 = 下一帧绘制会用的档。**

实证：`h ∈ [−0.4, 1.2]`、随机档距、随机初始标志，5 万次随机试验
`getObjectForDistance` 与随后 `update` **0 次不一致**。

由此，主问题化为两件事：

- **距离是不是同一把尺子？**（`zoom`）
- **标志是不是同一帧的快照？**（拾取是否早于 `update`）

---

## 2. 算例设定

一棵树，三档：

| 档 | 名称 | `D_i` | `h_i` | 近阈值 `T_i = D_i(1 − h_i)` |
|---|---|---|---|---|
| 0 | 近（高模 `A`） | 0 | 0 | —（第一档的 `h` 不参与判断） |
| 1 | 中（`B`） | 30 | 0.20 | **24** |
| 2 | 远（`C`） | 120 | 0.25 | **90** |

两处阈值在 double 下**精确**：`30 − 30*0.2 === 24`、`120 − 120*0.25 === 90`（已验证为
`true`），下文边界不会出现浮点毛刺。

滞回带（双稳态区间）：

- 近/中：`[24, 30)`，宽 6（= `D_1·h_1`）
- 中/远：`[90, 120)`，宽 30（= `D_2·h_2`）

两带**不重叠**（`T_2 = 90 > D_1 = 30`），因此无论初始 `visible` 标志是什么（包括首帧的全
`true`），`update` 调用 2 次就到达不动点，不会闪档（见 §3.2）。

---

## 3. 往返时真正发生切换的位置（`zoom = 1`）

扫描：相机沿 `(0,0,d)` 从 `d=5000` 以 0.005 步长逼近到 `d=0.5`，再反向远离，每步调用
`update(camera)`。比较是 `distance >= levelDistance`（`:277`），所以**恰好等于阈值时仍是
"远/粗"那一档，要再小一点才换档**。

| 方向 | 中↔远（`T_2=90` / `D_2=120`） | 近↔中（`T_1=24` / `D_1=30`） |
|---|---|---|
| 靠近（d 递减） | `d = 90` 仍是 `C`；`d = 89.995` 起 `B` | `d = 24` 仍是 `B`；`d = 23.995` 起 `A` |
| 远离（d 递增） | `d = 120` 起 `C` | `d = 30` 起 `B` |

**靠近在 90/24 附近换档，远离在 30/120 附近换档**——四组阈值不对称，这就是滞回的全部含义。
在 `[90,120)` 与 `[24,30)` 里，画哪一档取决于历史。

完整往返实测（每行先记录更新前的 flags 与拾取，再 `update` 两次，再拾取；`zoom=1`）：

| d | 更新前 flags | 更新后 draw | pick（更新前） | pick（更新后） |
|---|---|---|---|---|
| 300 | 001 | C | C | C |
| 121 | 001 | C | C | C |
| 120 | 001 | C | C | C |
| 119 | 001 | C | C | C |
| 91 | 001 | C | C | C |
| 90 | 001 | C | C | C |
| 60 | 001 | B | B | B |
| 31 | 010 | B | B | B |
| 30 | 010 | B | B | B |
| 25 | 010 | B | B | B |
| 24 | 010 | B | B | B |
| 10 | 010 | A | A | A |
| 24 | 100 | A | A | A |
| 29 | 100 | A | A | A |
| 30 | 100 | B | B | B |
| 60 | 010 | B | B | B |
| 90 | 010 | B | B | B |
| 119 | 010 | B | B | B |
| 120 | 010 | C | C | C |
| 300 | 001 | C | C | C |

`flags` 三位依次是 `A B C` 的 `visible`。**`zoom=1` 且标志已收敛时，draw 与 pick 逐行
相同**——这是定理 1 的直接体现。注意本表的取值是按整数值 `d` 采样，正好落在边界上，
所以 `d=90` 行显示 `C`、`d=24` 行显示 `B`；再走近 0.005 就会换档。

### 3.1 同一观察点，不同到达路径

`zoom=1`，只改"怎么到的这里"：

| 最终 d | 自远传送 | 自远逐步逼近 | 自近传送 | 首帧（从未 update，全档默认可见） |
|---|---|---|---|---|
| 18 | A | A | A | A |
| 29 | A | **B** | A | **B** |
| 45 | B | B | B | B |
| 75 | B | B | B | B |
| 95 | C | C | **B** | C |
| 119 | C | C | **B** | C |

例：`d=29` 落在 `[24,30)` 内。从远处传送过来时 `B` 不可见 → 阈值取 `D_1=30` →
`29 >= 30` 不成立 → 保持 `A`；而逐步逼近时 `B` 在 `d=30` 已变可见 → 阈值取 `T_1=24` →
`29 >= 24` → 保持 `B`。**"画哪档"不是 `d` 的函数，而是 `(d, 上一次的标志)` 的函数。**

### 3.2 首帧：走的是"从远处来"的分支

首帧时所有档默认 `visible = true`（`src/core/Object3D.js:299`），于是 `update`（`:271`）
对**每一档**都用近阈值 `T_i`。这正是"各档此前都可见"的判定分支——也就是**从极远处一路
走近、沿途把各档都打开过**的情形。

两带不重叠时（本文算例），这一分支恰好就是稳态：首帧结果与"自远逐步逼近"完全一致，
而与"从近处传送过来"不同。因此在滞回带内，首帧会偏向**更远、更低精度**的那一档：

| 最终 d | 首帧 draw | 自近处逐步走近 | 首帧是否不动点 |
|---|---|---|---|
| 5 | A | A | 是 |
| 20 | A | A | 是 |
| 25 | **B** | A | 是 |
| 29 | **B** | A | 是 |
| 35 | B | B | 是 |
| 50 | B | B | 是 |
| 89 | B | B | 是 |
| 95 | **C** | B | 是 |
| 119 | **C** | B | 是 |
| 121 | C | C | 是 |

两带不重叠时，首帧虽是"偏保守"的档，但它**本身是不动点**，第二帧起不再变化，也不会
出现"绘制与拾取不一致"——`getObjectForDistance` 与这一帧的 `update` 一致（定理 1）。

**当滞回带重叠（`T_i < D_{i-1}`）时，首帧只是一个瞬态**：第二帧里被关掉的档使阈值从
`T_i` 回落到 `D_i`，结果会跳变。例：`D = [0,20,100]`、`h = [0,0.9,0.9]` → `T = [2,10]`，
`T_2 = 10 < D_1 = 20`（重叠）：

| 最终 d | 第 1 帧 draw | 第 1 帧 pick | 第 2 帧 draw | 第 2 帧 pick |
|---|---|---|---|---|
| 11 | C | **A** | A | A |
| 15 | C | **A** | A | A |
| 19 | C | **A** | A | A |

本文算例 `T_2 = 90 > D_1 = 30`，不重叠，故没有这种现象。

一般性检查（随机档距、任意初始标志）：`h_i ∈ [0,1)` 时最多 3 次 `update` 收敛，从不振荡；
`h` 允许负值时会出现不收敛（实测 `h ∈ [−0.5,1.5]` 随机时，约 2.5% 的配置 50 帧内仍未收敛，
且这些配置的 draw 与 pick 长期不一致）。**建议在代码里保证 `h_i ≥ 0` 且
`D_i(1 − h_i) ≥ D_{i−1}`。**

---

## 4. "改变焦距"到底改了什么

### 4.1 `setFocalLength` / `fov`：与 LOD 无关

```js
// src/cameras/PerspectiveCamera.js:164-172
setFocalLength( focalLength ) {
  const vExtentSlope = 0.5 * this.getFilmHeight() / focalLength;
  this.fov = RAD2DEG * 2 * Math.atan( vExtentSlope );  // 只改 fov
  this.updateProjectionMatrix();
}
```

实测：`d=60`，把焦距改成 300 mm（`fov ≈ 6.68°`）后，`draw = B, pick = B`，与默认完全一致。
`fov` 只影响视锥和裁剪，LOD 的距离判据里没有它。

### 4.2 `camera.zoom`：绘制变了，拾取没变

`zoom` 进投影矩阵（`PerspectiveCamera.js:356`、`OrthographicCamera.js:196-200`），
也进 `LOD.update` 的距离（`LOD.js:261`），但**不进 `LOD.raycast`**（`:238`）。

设 `z = camera.zoom`：

- 绘制用等效距离 `δ = d / z`
- 拾取用 `d`
- 拾取阈值随"当前画的是哪一档"变化（可见用 `T`，隐藏用 `D`）

**绘制**换档点（精确）：靠近 `d = z·T_k`，远离 `d = z·D_k`。
**拾取**换档点：远离 `d = T_k` 或 `d = D_k`（取决于上档是否仍可见），靠近 `d = D_k`。

本文算例实测（`desc` = 靠近，`asc` = 远离；单位：世界距离 `d`）：

| zoom | 靠近：绘制换档 | 靠近：拾取换档 | 远离：绘制换档 | 远离：拾取换档 |
|---|---|---|---|---|
| 0.5 | 45 / 12 | 90 / 24 | 15 / 60 | 24 / 90 |
| **1** | **90 / 24** | **90 / 24** | **30 / 120** | **30 / 120** |
| 2 | 180 / 48 | 120 / 30 | 60 / 240 | 30 / 120 |
| 4 | 360 / 96 | 120 / 30 | 120 / 480 | 30 / 120 |

只有 `zoom = 1` 时两列完全重合。`zoom ≠ 1` 时，绘制换档点被 `z` 缩放，拾取不被缩放。

### 4.3 失配区间的闭式解（已逐点验证）

记 `z = camera.zoom`，`T_k = D_k(1 − h_k)`，稳态下。

一句话记法：**绘制用 `δ = d/z`，拾取用 `d`。`z > 1` 时 `δ < d`，绘制"以为更近"，于是
画出更精细的一档；`z < 1` 时 `δ > d`，绘制"以为更远"，画出更粗糙的一档。**

**靠近（d 递减）**

| 条件 | 失配区间 | 绘制（相对拾取） | 拾取 |
|---|---|---|---|
| `z > 1` 且 `z > 1/(1−h_k)` | `[D_k, z·T_k)` | 更精细 | 更粗糙 |
| `z < 1` | `[z·T_k, T_k)` | 更粗糙 | 更精细 |
| `z = 1` | 空 | — | — |

**远离（d 递增）**

| 条件 | 失配区间 | 绘制（相对拾取） | 拾取 |
|---|---|---|---|
| `z > 1` | `[D_k, z·D_k)` | 更精细 | 更粗糙 |
| `z < 1` 且 `z < 1−h_k` | `[z·D_k, T_k)` | 更粗糙 | 更精细 |
| `z = 1` | 空 | — | — |

（"更精细"指更靠近 `A` 端的高模，"更粗糙"指更靠近 `C` 端的低模。）

推导。只盯一个边界 `k`，设换档前画的是"较粗"的一侧、换档后是"较细"的一侧。

- **远离（d 递增）**，绘制在 `δ = D_k` 时换档，即 `d = z·D_k`；而拾取在 `d` 达到该档的
  有效阈值时换档，此时该档尚不可见，所以阈值是 `D_k`，即 `d = D_k`。两条线的先后由 `z`
  决定：`z > 1` 时绘制晚、拾取早，缝隙 `[D_k, z·D_k)`；`z < 1` 时绘制早、拾取晚，
  但拾取在 `d = D_k` 之后、`d = T_k` 之前仍会停在粗档（该档已被绘制打开，阈值变成 `T_k`），
  故缝隙 `[z·D_k, T_k)`，存在条件是 `z·D_k < T_k ⟺ z < 1 − h_k`。
- **靠近（d 递减）**：绘制在 `δ = T_k` 换档，即 `d = z·T_k`；拾取侧的对应阈值是
  "换档前该档可见 → `T_k`"，但一旦绘制先把它关掉，阈值就回落到 `D_k`。于是
  `z > 1` 时绘制晚（`z·T_k > T_k`）、拾取要等 `D_k`，缝隙 `[D_k, z·T_k)`；
  `z < 1` 时绘制早（`z·T_k < T_k`）、拾取仍按 `T_k`，缝隙 `[z·T_k, T_k)`。

两条缝隙都只在"绘制与拾取用了不同阈值"时出现，`z = 1` 时两者恒等，故为空。

实测（步长 0.005，`d ∈ [0.5, 5000]`，已剔除几何未命中）：

| zoom | 方向 | 闭式预测 | 实测 |
|---|---|---|---|
| 0.5 | 靠近 | `[12,24)`、`[45,90)` | `[12.00, 24.00]`、`[45.00, 90.00]` |
| 0.5 | 远离 | `[15,24)`、`[60,90)` | `[15.00, 24.00]`、`[60.00, 90.00]` |
| 0.9 | 靠近 | `[21.6,24)`、`[81,90)` | `[21.60, 24.00]`、`[81.00, 90.00]` |
| 0.9 | 远离 | 空（`0.9 > 1−h`） | 无 |
| 1 | 两向 | 空 | 无 |
| 1.2 | 远离 | `[30,36)`、`[120,144)` | `[30.00, 36.00]`、`[120.00, 144.00]` |
| 1.2 | 靠近 | 空（`1.2 < 1.25`） | 无 |
| 1.3 | 靠近 | `[30,31.2)`（k=1 有，k=2 无） | `[30.00, 31.20]` |
| 1.3 | 远离 | `[30,39)`、`[120,156)` | `[30.00, 39.00]`、`[120.00, 156.00]` |
| 1.5 | 靠近 | `[30,36)`、`[120,135)` | `[30.00, 36.00]`、`[120.00, 135.00]` |
| 1.5 | 远离 | `[30,45)`、`[120,180)` | `[30.00, 45.00]`、`[120.00, 180.00]` |
| 2 | 靠近 | `[30,48)`、`[120,180)` | `[30.00, 48.00]`、`[120.00, 180.00]` |
| 2 | 远离 | `[30,60)`、`[120,240)` | `[30.00, 60.00]`、`[120.00, 240.00]` |
| 4 | 靠近 | `[30,96)`、`[120,360)` | `[30.00, 96.00]`、`[120.00, 360.00]` |
| 4 | 远离 | `[30,120)`、`[120,480)` | `[30.00, 120.00]`、`[120.00, 480.00]` |

**`z` 远离 1 时会"连环"，上表给的是单边界包络。** 相邻两档的失配带可能重叠或首尾相接，
此时实际可能相差两档以上。实测：

| zoom | 方向 | 实测失配带（`画/选`） |
|---|---|---|
| 0.25 | 靠近 | `[30,90)` 画 C 选 B；`[22.5,30)` 画 C 选 A；`[6,22.5)` 画 B 选 A |
| 0.2 | 远离 | `[30,90)` 画 C 选 B；`[24,30)` 画 C 选 A；`[6,24)` 画 B 选 A |
| 8 | 靠近 | `[30,120)` 画 A 选 B；`[120,192)` 画 A 选 C；`[192,720)` 画 B 选 C |
| 8 | 远离 | `[30,120)` 画 A 选 B；`[120,240)` 画 A 选 C；`[240,960)` 画 B 选 C |

所以 §4.3 的两张表用于回答"有没有分离、分离上下界在哪"，而不是"一定只差一档"。

### 4.4 `zoom = 2` 靠近的逐点明细

`δ = d/2`：

| d | δ | 绘制 | 拾取 | 说明 |
|---|---|---|---|---|
| 240 | 120.0 | C | C | 一致 |
| 181 | 90.5 | C | C | 一致 |
| 180 | 90.0 | C | C | 边界（`δ = T_2`） |
| 179 | 89.5 | **B** | **C** | 绘制在 `z·T_2=180` 换档；拾取还在 90 以上 |
| 150 | 75.0 | B | C | 失配带 `[120,180)` 内 |
| 121 | 60.5 | B | C | 同上 |
| 120 | 60.0 | B | C | 边界：拾取仍取 `D_2`（C 已隐藏） |
| 119 | 59.5 | B | B | 拾取跟上 |
| 60 | 30.0 | B | B | 一致（`δ=T_1=24` 以上） |
| 49 | 24.5 | B | B | 一致 |
| 48 | 24.0 | B | B | 边界（`δ = T_1`） |
| 47 | 23.5 | **A** | **B** | 绘制在 `z·T_1=48` 换档 |
| 31 | 15.5 | A | B | 失配带 `[30,48)` 内 |
| 30 | 15.0 | A | B | 边界 |
| 29 | 14.5 | A | A | 拾取跟上 |

**这就是"相机改变焦距后，画出来的树和射线选中的树是不是同一档"的直接答案**：
用 `camera.zoom` 变焦时，在 `[D_k, z·T_k)`（靠近）/ `[D_k, z·D_k)`（远离）这些区间里，
`z > 1`（拉近放大）画的是**更精细**的树，射线打中的是**更粗糙**的那档；`z < 1` 反过来。
用 `setFocalLength` 改 `fov` 则完全不会出现这种分离。

> 直观解释：`zoom` 放大画面时，代码认为相机"变近了"（`δ = d/z` 变小），于是认为该看到更多
> 细节、切到**更精细**的一档；但射线原点的位置没变，距离仍是 `d`，所以拾取还停在
> **更粗糙**那一档的判定区间里。

---

## 5. 同一观察点：何时相同、何时分离

### 5.1 判据

**相同（以下全部成立时必然相同）**

1. `camera.zoom === 1`；
2. `update` 与 `setFromCamera` 用**同一台相机、同一姿态**，且该姿态已经过一次 `render`
   （或你手动调过 `lod.update(camera)`），`autoUpdate === true`；
3. `LOD` 及其所有祖先 `visible === true`，且 `LOD.layers` 与 `camera.layers` 有交集；
4. 透视相机（正交相机需光标恰在中心）；
5. 用 **`intersectObject(lod, false)`**（或直调 `lod.raycast`），不要对 LOD 做递归拾取；
6. 所有 `h_i ≥ 0`，且滞回带不重叠（`D_i(1−h_i) ≥ D_{i−1}`），保证至多 3 次 `update`
   内收敛到不动点。

实测：满足 1、2、6 时，`zoom=1` 随机配置的 `draw != pick` 为 **0 / 20000**；
把 `h` 放到 `[−0.5, 1.5]` 则约 2.5% 失败（这些正是 §3.2 中 50 帧内不收敛的配置）。

**分离（任一出现即可能不同档）**

| # | 触发条件 | 机制 | 实例 |
|---|---|---|---|
| 1 | `camera.zoom ≠ 1` | 绘制除 `zoom`，拾取不除 | §4.3 全部失配带 |
| 2 | 相机已移动、尚未重绘就拾取 | 拾取读的是上一帧标志 | §5.2 |
| 3 | `autoUpdate === false` | 同 2，且永不纠正 | 屏幕恒 `C`，拾取随 `d` 变 |
| 4 | `intersectObject(lod, true)` 或对 scene 递归 | 隐藏档也被遍历，排序后最近命中可能是隐藏档 | §5.3 |
| 5 | 正交相机 + 光标偏离中心 | 拾取距离 `√(d²+lat²) > d` | §5.4 |
| 6 | `LOD.visible === false` 或 layers 不匹配 | 渲染跳过 `update`，拾取仍下钻 | §5.5 |
| 7 | 从未渲染过的 LOD 首帧 | 首帧按"全可见"取阈值；带重叠时下一帧才纠正 | §3.2 |
| 8 | 同一 LOD 被多相机/多视口渲染 | `visible` 是 LOD 级共享状态 | §5.6 |
| 9 | 档对象不是 Mesh（如 `Group`） | `Group.raycast` 为空实现，非递归拾取 0 命中 | `intersectObject(lod,false)` 返回 `[]` |
| 10 | XR | 渲染用 `xr.getCamera()`（`ArrayCamera`，`zoom` 被置 1，`WebXRManager.js:744`） | 需按实际渲染相机核对 |

### 5.2 陈旧标志（最常见的线上问题）

场景：相机在 `d=300` 渲染过（`draw = C, flags = 001`），用户把相机推到近处，点击回调在
下一帧 `render` **之前**执行，`raycast` 用的是 `flags = 001`：

| 相机移到（未重绘） | 屏幕仍显示 | 拾取命中 |
|---|---|---|
| 150 | C | C |
| 120 | C | C |
| 100 | C | C |
| 90 | C | C |
| 89 | C | **B** |
| 60 | C | **B** |
| 40 | C | **B** |
| 30 | C | **B** |
| 29 | C | **A** |
| 24 | C | **A** |
| 23 | C | **A** |
| 15 | C | **A** |
| 10 | C | **A** |

用户看到远档的树，点下去拿到中/近档对象。**这与 `zoom` 无关**，`zoom=1` 同样发生。

极端情况：`autoUpdate = false` 时标志永不更新，`draw` 恒为 `C`，而拾取随 `d` 在
`C/B/A` 之间跳。

### 5.3 递归拾取会命中隐藏档

`LOD.raycast` 只把一个档交给 raycaster，但它**不阻止** `Raycaster.intersect()` 继续遍历
`children`。于是 `intersectObject(lod, true)` 会把三档几何全测一遍。三档尺寸不同
（低模通常更小）时，**最近命中常来自已被隐藏的高模**：

```
draw = C, flags = 001
intersectObject(lod, false) → C@298
intersectObject(lod, true)  → A@280, B@295, C@298, ...     ← 最近命中是 A
```

（实测配置：三档盒体边长 40 / 10 / 4，相机 `d=300`。）

对 `scene` 做递归拾取（`raycaster.intersectObjects(scene.children, true)`）与此等价。
这是"点中了看不见的模型"的最主要原因。

正确做法：命中后取 `hit.object.parent`（即 LOD），再用**同一距离口径**判档，或直接用
`lod.getCurrentLevel()`（"所见即所点"）。注意 `getObjectForDistance` 不知道 `zoom`，
跨 zoom 场景要手动换算（见 §6 第 1 条）。

### 5.4 正交相机：拾取距离被光标位置放大

`Raycaster.setFromCamera`（`src/core/Raycaster.js:127-131`）：

```js
this.ray.origin.set( coords.x, coords.y, camera.projectionMatrix.elements[ 14 ] )
  .unproject( camera );   // 落在"过相机位置、垂直视线"的平面上
this.ray.direction.set( 0, 0, -1 ).transformDirection( camera.matrixWorld );
```

反投影后 `origin` 的视线方向分量恰为 0（实测相机在 `(0,0,0)` 时，无论 `near` 取
0.1/5/20/50，`origin` 都是 `(x, y, 0)`）。所以

```
pickDistance = √(d² + x_ndc²·halfWidth² + y_ndc²·halfHeight²)
```

而绘制用 `d`（或 `d/zoom`）。光标越靠边，拾取距离越大，会推向更远的档。

实测（本文算例，体积 300³ 的盒、`DoubleSide`，`OrthographicCamera(-100,100,100,-100)`，
相机 `z=20`，`draw = A`，`flags = 100`）：

| 光标 NDC.x | 拾取距离 | `getObjectForDistance` | 实际命中 |
|---|---|---|---|
| 0.0 | 20.00 | A | A |
| 0.2 | 28.28 | A | A |
| 0.4 | 44.72 | **B** | **B** |
| 0.6 | 63.25 | B | B |
| 1.0 | 101.98 | B | B |

注意 `NDC=0.4` 时命中 `B`，而 `B` 当时 `visible=false`——因为 `LOD.raycast`（`:240`）
不检查选中档的可见性。屏幕上只有一个 `A`，射线却返回 `B`。

透视相机没有这个问题：`origin` 就是相机位置，任一光标位置算出的距离都等于
`|camera − LOD|`（实测 `(0,0)`、`(0.9,0.9)`、`(-0.9,0.9)` 三处均为 `90.000000`）。

### 5.5 `visible` / `layers`：渲染跳过，拾取照打

- `LOD.visible = false`：`projectObject` 在 `:1878` 直接返回，`update` 不跑，标志冻结；
  但 `raycaster.intersectObject(lod, true)` 仍会命中全部档（Raycaster 不看 `visible`）。
- `LOD.layers.set(5)`（相机与射线都在 layer 0）：`:1880` 使 `update` 不被调用，但
  `:1984-1988` 的子节点遍历不受 `layers` 影响，子节点仍按**旧标志**绘制；
  拾取侧 `LOD.raycast` 因 LOD 自身 layers 不匹配被跳过，随后递归下钻——命中所有档。
- 档位对象本身 layers 不匹配：递归拾取会跳过它，但非递归 `lod.raycast` 会直接调它的
  `raycast`（因为 `:240` 不检查 layers 也不检查 visible），于是**仍会命中**。

### 5.6 一个 LOD 被多台相机渲染

`visible` 标志挂在 LOD 对象上，是共享状态。A 相机 `d=10` 渲染后标志为 `100`，
B 相机 `d=200` 渲染后变成 `001`。此时用 A 的位姿拾取，得到的是"按 B 留下的标志"判的档；
而 A 视口画的是它上一帧的档。多视口/分屏/VR 下要么每个视口一个 LOD，要么拾取时先
`lod.update(对应相机)`。

---

## 6. 实践建议

1. **明确"改变焦距"用哪个 API。**
   - 只想要长焦压缩感、不希望 LOD 变 → 用 `camera.setFocalLength()` 或直接改 `fov`。
   - 用 `camera.zoom` 变焦 → 绘制/拾取会在 §4.3 的区间分离。若希望拾取与绘制一致，
     把 zoom 显式带进拾取判档：`lod.getObjectForDistance(d / camera.zoom)`
     （把世界距离换成 `update` 内部使用的"等效距离" `δ = d/zoom`）。
     实测：在 `zoom ∈ {0.25…4}`、双向扫描共 95984 个采样点上，
     `getObjectForDistance(d/zoom)` 与 `getCurrentLevel()` **全部一致**；
     写反成 `d * zoom` 只有 90850/95984 一致。
2. **拾取不要走 LOD 的递归路径。** 用 `intersectObject(lod, false)`；若必须对整场景递归，
   命中后按 `hit.object.parent` 找到 LOD，重新判档；或直接读 `lod.getCurrentLevel()`。
3. **不要在"相机已变、尚未渲染"的窗口里做命中判定**，或在该窗口内先手动
   `lod.update(camera)`。
4. 配置 `h` 时保证 `h_i ≥ 0` 且 `D_i(1−h_i) ≥ D_{i−1}`，避免首帧闪档、多帧振荡与带重叠。
5. 若 LOD 会被 `visible=false` 的父级或 layers 过滤，别指望 `update` 维护标志；显式调用。
6. 需要强一致时，最稳妥的是让拾取档直接等于 `lod.getCurrentLevel()`——因为绘制档本身
   依赖历史与 `zoom`，重新推一遍容易推错。

---

## 7. 复现方法

所有数字由不依赖 WebGL 的 Node 脚本产生（直接 `import` `src/` 下的 ESM 模块）：

```js
import { LOD } from './src/objects/LOD.js';
import { Mesh } from './src/objects/Mesh.js';
import { BoxGeometry } from './src/geometries/BoxGeometry.js';
import { MeshBasicMaterial } from './src/materials/MeshBasicMaterial.js';
import { Raycaster } from './src/core/Raycaster.js';
import { PerspectiveCamera } from './src/cameras/PerspectiveCamera.js';
import { Vector2 } from './src/math/Vector2.js';

const lod = new LOD();
for ( const [ name, D, h ] of [ [ 'A', 0, 0 ], [ 'B', 30, 0.2 ], [ 'C', 120, 0.25 ] ] ) {
  const m = new Mesh( new BoxGeometry( 2, 2, 2 ), new MeshBasicMaterial() );
  m.name = name; lod.addLevel( m, D, h );
}
lod.updateMatrixWorld( true );

const cam = new PerspectiveCamera( 50, 1, 0.001, 1e6 );
cam.zoom = 2; cam.updateProjectionMatrix();

const setD = d => { cam.position.set( 0, 0, d ); cam.updateMatrixWorld( true ); };
const pick = () => {
  const rc = new Raycaster(); rc.setFromCamera( new Vector2( 0, 0 ), cam );
  const hits = rc.intersectObject( lod, false );
  return hits.length ? hits[ 0 ].object.name : 'MISS';
};

setD( 5000 ); lod.update( cam );
for ( let d = 5000; d >= 0.5; d -= 0.01 ) {
  setD( d ); lod.update( cam );
  const draw = lod.levels[ lod.getCurrentLevel() ].object.name;
  if ( draw !== pick() ) console.log( d.toFixed( 2 ), draw, pick() );
}
```

输出即为 §4.3 的 `zoom=2` 靠近失配带 `[120,180)`、`[30,48)`（首尾各差一个浮点步长，
打印为 `[120.01, 180.00]`、`[30.01, 48.00]`）。把 `cam.zoom` 改成 `1`，这两段输出消失
（只剩极近距离 `d < ~1` 下盒子太小的 `MISS`，那是几何未命中，与档位选择无关）。
