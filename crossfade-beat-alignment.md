# Crossfade 与节拍对齐分析

分析对象是当前仓库的 `src/animation/AnimationMixer.js` 和 `src/animation/AnimationAction.js`。

下文采用最常见的步态配置：

- 两个片段均为 `LoopRepeat`；
- 周期分别为 `T_fast = 1s`、`T_slow = 2s`；
- `action.weight = 1`、`action.timeScale = 1`、未暂停；
- `mixer.timeScale = 1`；
- 使用普通混合模式；
- `D` 表示 `crossFade*` 的淡化时长，按 mixer 时间计算。

这里把**相位**定义为归一化循环位置：

\[
p=\frac{\text{action.time}}{T}\pmod 1
\]

并且要求两个步态片段的 `p=0` 或 `p=0.5` 对应同一种落脚事件；源码本身不知道哪一帧是脚跟落地或重拍。

## 核查步骤

1. `AnimationMixer.update()` 先用 `mixer.timeScale` 缩放 delta，再推进 `mixer.time`，随后调用每个 action 的 `_update()`，见 [AnimationMixer.js:676-695](src/animation/AnimationMixer.js#L676-L695)。
2. `crossFadeFrom()` 只做两件事：给 outgoing/incoming 安排线性权重包络；当 `warp=true` 时再安排线性时间缩放包络。它不会设置 `action.time`，见 [AnimationAction.js:337-360](src/animation/AnimationAction.js#L337-L360)。
3. 权重由基础 `weight` 乘以权重插值器得到，见 [`_updateWeight()`](src/animation/AnimationAction.js#L641-L675)。
4. 播放速度由基础 `timeScale` 乘以时间缩放插值器得到，见 [`_updateTimeScale()`](src/animation/AnimationAction.js#L678-L725)。
5. action 自己的 `time` 只在 [`_updateTime()`](src/animation/AnimationAction.js#L727-L883) 中推进、回绕；crossfade 不会替调用方对齐它。

## 最终答案

### 1. Crossfade 不能从任意起始姿态自动对齐相位

**不能。** `crossFadeTo()` / `crossFadeFrom()` 不修改两个 action 的当前时间或起始相位。普通交叉淡化只是在两个已有姿态之间做权重混合；即使中点权重为 `0.5/0.5`，也不意味着两只脚或两段步态进入了同一相位。

若起始相位任意，中点通常会得到两个不同相位步态的平均姿态，可能出现滑步、双脚位置折中或“两只脚不属于同一个节拍”的效果。时间扭曲可以**保持已经对齐的归一化相位差**，但不能消除任意初始相位差。

#### 中点权重

设淡化起点为 \(t_0=\text{mixer.time}\)，中点为 \(t_0+D/2\)。权重包络是线性的：

\[
w_{\text{out}}(u)=1-u,\qquad w_{\text{in}}(u)=u
\]

其中 \(u=(\text{mixer.time}-t_0)/D\)。因此中点 \(u=0.5\)：

\[
\boxed{w_{\text{out}}=0.5,\qquad w_{\text{in}}=0.5}
\]

更一般地，有效权重还要乘各自的基础 `weight`：

\[
w_{\text{out,eff}}=0.5\,\text{weight}_{\text{out}},\qquad
w_{\text{in,eff}}=0.5\,\text{weight}_{\text{in}}
\]

如果 action 被禁用，有效权重为 `0`。在默认基础权重均为 `1` 时，两个权重之和为 `1`，`PropertyMixer` 会形成等量归一化混合。

#### 中点有效播放速度

`getEffectiveTimeScale()` 返回的是 action 级速度，不包含 `mixer.timeScale`。若全局 `mixer.timeScale=M`，真实墙钟播放速率还要再乘 \(M\)。

| 配置 | 1 秒片段的 `_effectiveTimeScale` | 2 秒片段的 `_effectiveTimeScale` | 归一化相位速率 \(s/T\) |
|---|---:|---:|---:|
| `warp=false`，中点 | `1` | `1` | `1 Hz` 与 `0.5 Hz` |
| `warp=true`，中点 | \(\boxed{0.75}\) | \(\boxed{1.5}\) | 两者都是 \(\boxed{0.75\text{ cycles/s}}\) |

也就是说，开启 warp 后，中点处：

- 1 秒步态减速到 `0.75×`，有效循环长度 \(1/0.75=4/3\) 秒；
- 2 秒步态加速到 `1.5×`，有效循环长度 \(2/1.5=4/3\) 秒；
- 两者的**归一化相位速率相同**，中点瞬时节拍长度都是 \(4/3\) 秒（若 \(M=1\)）。

方向不改变这组对应关系：

- **1 秒 → 2 秒**：
  - outgoing 1 秒：`warp(1, 1/2, D)`，速度 `1 → 0.5`，中点 `0.75`；
  - incoming 2 秒：`warp(2, 1, D)`，速度 `2 → 1`，中点 `1.5`。
- **2 秒 → 1 秒**：
  - outgoing 2 秒：`warp(1, 2, D)`，速度 `1 → 2`，中点 `1.5`；
  - incoming 1 秒：`warp(1/2, 1, D)`，速度 `0.5 → 1`，中点 `0.75`。

源码中的比例来自 [AnimationAction.js:344-355](src/animation/AnimationAction.js#L344-L355)：

```js
startEndRatio = fadeOutDuration / fadeInDuration
endStartRatio = fadeInDuration / fadeOutDuration
```

#### 为什么 warp 能保持相位，但不能创造对齐

令 outgoing/incoming 周期为 \(T_o,T_i\)，淡化进度为 \(u\)。warp 下两者速度分别为：

\[
s_o(u)=1+\left(\frac{T_o}{T_i}-1\right)u
\]

\[
s_i(u)=\frac{T_i}{T_o}+\left(1-\frac{T_i}{T_o}\right)u
      =\frac{T_i}{T_o}s_o(u)
\]

所以归一化相位速率始终相同：

\[
\frac{s_i(u)}{T_i}=\frac{s_o(u)}{T_o}
\]

因此从 \(t_0\) 开始，两段动作增加的相位完全相同：

\[
p_i(t)-p_o(t)=p_i(t_0)-p_o(t_0)\pmod 1
\]

如果开始时相位一致，整个 crossfade 包括中点都会一致；如果开始时相差 `0.3` 个循环，那么中点和淡化结束时仍相差约 `0.3` 个循环。**warp 保持相位差，不修复相位差。**

warp 实际上把共同相位速率从 outgoing 的原生频率线性过渡到 incoming 的原生频率。对 1 秒和 2 秒步态：

- 1 秒 → 2 秒：共同相位速率从 `1 Hz` 过渡到 `0.5 Hz`；
- 2 秒 → 1 秒：从 `0.5 Hz` 过渡到 `1 Hz`；
- 中点都是折中值 `0.75 Hz`。

若一个完整循环包含左右两次落脚，则中点瞬时脚步间隔是 \((4/3)/2=2/3\) 秒；但源码没有“脚步点”概念，调用方需要知道 `.5` 相位代表另一只脚。

---

### 2. 关闭与开启时间扭曲时，淡化结束后的时钟走向

#### 关闭 warp：`crossFadeTo(in, D, false)`

- 两个 action 的 `timeScale` 都保持调用前的值；默认都是 `1`。
- 1 秒 action 继续按每秒 `1` 个循环推进，2 秒 action 按每秒 `0.5` 个循环推进。
- 中点权重虽然是 `0.5/0.5`，但两者的相位速率分别是 `1 Hz` 和 `0.5 Hz`，节拍并不匹配。
- 淡化终点后：
  - outgoing 的权重到达 `0`，随后 `_updateWeight()` 将其 `enabled` 设为 `false`，见 [AnimationAction.js:656-665](src/animation/AnimationAction.js#L656-L665)；
  - 下一次 `_update()` 在 [AnimationAction.js:567-573](src/animation/AnimationAction.js#L567-L573) 提前返回，**outgoing 的 `action.time` 不再推进，冻结在最后回绕后的位置**；
  - incoming 保持启用，自己的 `time` 继续按原生 `timeScale=1` 推进和回绕；如果 incoming 是 2 秒片段，之后就是每 2 秒一圈，如果是 1 秒片段，就是每 1 秒一圈。

注意：仅仅权重为 `0` 不会停止时钟；手动设置 `weight=0` 后 `_updateTime()` 仍会运行。crossfade 的 outgoing 之所以冻结，是因为淡化完成时额外设置了 `enabled=false`。

#### 开启 warp：`crossFadeTo(in, D, true)`

淡化过程中，两个 action 的有效速度按上面的比例线性变化，使已经对齐的归一化相位保持一致。

淡化结束后要区分 **warp 终点目标值** 和 **当前源码完成 warp 后的恢复值**：

- incoming 的 warp 终点本来就是 `1`，所以结束后通常无跳变，继续以默认 `timeScale=1` 按原生周期行走。
- outgoing 的 warp 终点是周期比，例如 1 秒 → 2 秒时为 `0.5`，2 秒 → 1 秒时为 `2`；但当前源码在 warp 完成分支中会读取 `_restoreTimeScale`，把 `this.timeScale` 恢复到 crossfade 前保存的值，通常是 `1`，见 [AnimationAction.js:694-715](src/animation/AnimationAction.js#L694-L715)。
- 同一个边界附近，outgoing 的权重包络也完成并把 `enabled` 设为 `false`，所以它不会在恢复后的原生速度下长期运行；它的 action clock 随后冻结。
- incoming 的 `_restoreTimeScale` 同样被恢复为调用前的基础速度；默认情况下终点值和恢复值都是 `1`，因此之后按 1 秒或 2 秒的原生周期继续。

严格按源码的帧边界行为：代码判断的是 `mixer.time > endTime`，不是 `>=`。如果某一帧正好等于终点，包络器仍挂着但权重/速度已经是端点值；之后第一次严格超过终点的 update 会完成清理。由于帧 delta 可能越过终点，outgoing 可能用恢复后的 `timeScale` 多推进一个越界帧，然后才被禁用并冻结。该帧权重已经为 `0`，视觉上通常不可见，但之后若不重置就重新启用 outgoing，会从这个旧时间继续，而不是从 `0` 开始。

因此，**warp 不是永久把两个时钟锁成 `4/3` 秒周期**。`0.75/1.5` 只是中点瞬时值；warp 负责过渡节拍，淡化结束后幸存的 incoming 时钟回到其基础 `timeScale` 和原生片段周期。

#### 复用 outgoing 时

crossfade 的自动 fade-out 不等于调用 `stop()`：

- 它设置 `enabled=false`，但不清零 `time`；
- `stop()` 才会 deactivate，并通过 `reset()` 把 `time=0`、清除 fading/warping，见 [AnimationAction.js:189-213](src/animation/AnimationAction.js#L189-L213)。

所以再次使用旧 action 前，应显式 `reset()`，或至少恢复 `enabled`、权重、timeScale 和需要的相位。官方 blending 示例的做法是重新 `enabled=true`、调用 `setEffectiveTimeScale(1)` 与 `setEffectiveWeight(weight)`，并在交接前设置 `endAction.time=0`，见 [webgl_animation_skinning_blending.html:395-417](examples/webgl_animation_skinning_blending.html#L395-L417)。

---

### 3. 调用方应怎样安排起拍

#### 推荐做法：在 crossfade 开始时对齐归一化相位，并开启 warp

在调用 `crossFadeTo()` 前，把 incoming 的相位设成 outgoing 当前相位：

\[
p=\frac{\text{out.time}\bmod T_o}{T_o}
\]

\[
\text{in.time}=p\,T_i
\]

对于 \(T_o=1,T_i=2\)，应把 2 秒 action 的时间设为 1 秒 action 归一化相位的两倍，而不是复制绝对秒数。

```js
const mod1 = x => ((x % 1) + 1) % 1;

function alignedCrossfade(outAction, inAction, duration) {
  const Tout = outAction.getClip().duration;
  const Tin = inAction.getClip().duration;

  // 相位原点必须在两个步态片段中表示同一种落脚/重拍事件。
  const phase = mod1(outAction.time / Tout);

  inAction.reset().play();
  inAction.time = phase * Tin;
  inAction.enabled = true;
  inAction.setEffectiveTimeScale(1);
  inAction.setEffectiveWeight(1);

  outAction.play();
  outAction.enabled = true;
  outAction.setEffectiveTimeScale(1);
  outAction.setEffectiveWeight(1);

  outAction.crossFadeTo(inAction, duration, /* warp */ true);
}
```

不要在周期不同的情况下直接用 `inAction.syncWith(outAction)` 来做相位对齐：[`syncWith()`](src/animation/AnimationAction.js#L447-L453) 复制的是绝对秒数 `this.time = action.time`，不是归一化相位。例如 `out.time=0.5` 对 1 秒片段是半圈，对 2 秒片段复制成 `0.5` 后却只是四分之一圈。

最稳妥的节拍触发方式是像官方示例那样等待 outgoing 的 `loop` 事件：在循环边界执行 crossfade，并把 incoming 的 `time` 设为 `0`。如果重拍对应另一只脚，则使用双方共同的语义相位（通常是 `0.5`），而不是机械地都设为 `0`。

#### 如果要求“淡化中点”本身正好落在重拍上

设希望中点相位为 \(p_b\)（通常 `0` 是循环/主重拍，`0.5` 是另一只脚）。warp 下，从淡化起点到中点新增的相位为：

\[
\Delta p_{\text{mid}}
=
\frac{D}{T_o}\left(\frac{3+T_o/T_i}{8}\right)
\]

所以淡化起点应使用：

\[
\boxed{p_0=\operatorname{mod}_1(p_b-\Delta p_{\text{mid}})}
\]

对周期 1 秒和 2 秒：

- **1 秒 outgoing → 2 秒 incoming**：

  \[
  \Delta p_{\text{mid}}=\frac{7D}{16}
  \]

- **2 秒 outgoing → 1 秒 incoming**：

  \[
  \Delta p_{\text{mid}}=\frac{5D}{16}
  \]

然后令：

\[
\text{out.time}=p_0T_o,\qquad \text{in.time}=p_0T_i
\]

如果 outgoing 已经在画面中播放，直接改 `out.time` 会产生姿态跳变。此时应让它自然走到 \(p_0\) 后再发起 crossfade。假设当前相位是 \(p_{\text{now}}\)、速度为默认 `1`，等待时间为：

\[
t_{\text{cue}}
=
T_o\,\operatorname{mod}_1(p_0-p_{\text{now}})
\]

到 cue 时再把 incoming 设为 \(p_0T_i\) 并调用 `crossFadeTo(..., true)`。这样中点会落在指定的 \(p_b\)。

#### 不使用 warp 时的中点补偿

关闭 warp 后，两个片段的归一化相位速率分别是 \(1/T_o\) 和 \(1/T_i\)。若只要求它们在中点 \(D/2\) 处同相，可以把 incoming 的起始相位预先补偿为：

\[
p_{i,0}
=
\operatorname{mod}_1
\left(
p_{o,0}
+\frac D2\left(\frac1{T_o}-\frac1{T_i}\right)
\right)
\]

对 1 秒 outgoing、2 秒 incoming：

\[
p_{i,0}=p_{o,0}+\frac D4\pmod 1
\]

这能让两者只在中点相遇；中点之后相位仍会继续分开，淡化后段的混合质量通常不如开启 warp。若还要求中点恰好是某个重拍 \(p_b\)，则必须安排 outgoing 在中点自然到达 \(p_b\)，因为调用方无法用内置 crossfade 在不改变 outgoing 时钟的情况下强制它落到指定相位。

#### `startAt()` 的注意事项

[`startAt(time)`](src/animation/AnimationAction.js#L246-L252) 只设置 action 自己的 `_startTime`，其追赶逻辑在 [AnimationAction.js:576-595](src/animation/AnimationAction.js#L576-L595)。它不会延迟 `fadeIn()`、`fadeOut()` 或 `warp()` 的包络起点；这些包络在调用时直接以当前 `mixer.time` 为起点，见 [AnimationAction.js:922-942](src/animation/AnimationAction.js#L922-L942) 和 [`warp()` 的时间写入](src/animation/AnimationAction.js#L493-L500)。

因此：

- 若希望整个交接在未来某个 mixer time 发生，应在渲染循环或节拍回调中等到该时刻再调用 `crossFadeTo()`；
- 只提前调用 `crossFadeTo()` 再设置 `startAt(future)`，权重和 warp 仍会立刻开始，而 action 时钟在预定时间前不推进，不能得到正确的同步淡化；
- `startAt(mixer.time - p_0T)` 或负的过去时间也可用来制造起始相位偏移，但直接设置 `action.time = p_0T` 更直观、更接近精确帧位置。

淡化结束后，若幸存 incoming 在 \(t_1=t_0+D\) 的相位是 \(p_1\)，默认速度下一次到达相位 \(p_b\) 的时间为：

\[
\Delta t_{\text{next beat}}
=
T_i\,\operatorname{mod}_1(p_b-p_1)
\]

也可以继续监听该 action 的 `loop` 事件来安排循环边界上的音频或脚步提示。

## 简表

- 任意起始相位：crossfade **不能自动对齐**；它只混合姿态，不改相位。
- 中点权重：默认配置下 **out/in 都是 `0.5`**。
- 中点速度（warp=true）：**1 秒片段 `0.75×`，2 秒片段 `1.5×`**；两者归一化速率都是 **`0.75 Hz`**，有效周期均为 **`4/3 s`**。
- 中点速度（warp=false）：两者都是 **`1×`**；相位速率分别为 **`1 Hz`、`0.5 Hz`**。
- warp 的作用：让已经同相的两段步态在淡化中保持同相，并把节拍从旧周期平滑过渡到新周期；它不消除初始相位差。
- 淡化后：outgoing 到零权重后被禁用，action clock 冻结；incoming 继续运行，warp 完成后回到调用前的基础 `timeScale`（默认 `1`）和原生周期。
- 调用方：应在 loop/重拍边界或计算出的相位 cue 上，按 `time/T` 成比例设置 incoming 的起始相位，再开启 warp crossfade；不要直接对周期不同的动作使用复制绝对秒数的 `syncWith()`。
