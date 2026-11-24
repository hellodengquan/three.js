# InstancedMesh：整体包围球与逐实例射线相交的关系

> 现象：场景编辑器把一组实例中最外侧的实例移到新位置，渲染画面里它出现在新位置，但射线拾取（点击）却选不中它。
> 结论先行：**逐实例求交永远使用最新的 `instanceMatrix`，与渲染一致；整体包围球 `boundingSphere` 是缓存值，只在为 `null` 时才惰性计算一次，移动实例后不会自动失效。陈旧的包围球只会"误杀"（提前 return），不会"误中"，于是出现"看得见、点不到"。**

涉及的源码（均以当前仓库为准）：

- `src/objects/InstancedMesh.js:259-309` — `raycast()`：先整体包围球测试，再逐实例测试
- `src/objects/InstancedMesh.js:152-181` — `computeBoundingSphere()`：对所有实例的局部包围球取并集
- `src/objects/Mesh.js:248-290` — 单实例（借用 `_mesh`）的求交：几何包围球 → 逆变换射线 → 三角形级求交
- `src/math/Frustum.js:148-168` — 视锥剔除同样使用 `object.boundingSphere`
- `src/math/Sphere.js:266-273` — `applyMatrix4`：中心乘矩阵、半径乘最大轴缩放

---

## 1. 带父节点变换的数值例子

### 场景设定

- 几何体：`SphereGeometry(1)`，其 `geometry.boundingSphere` = 球心 `(0,0,0)`、半径 `1`。
- `InstancedMesh` 共 2 个实例，实例局部矩阵均为纯平移：
  - 实例 0：局部位置 `(0, 0, 0)`
  - 实例 1：局部位置 `(4, 0, 0)`（最外侧实例）
- 父节点：`Group`，位置 `(10, 0, 0)`，无旋转缩放。`InstancedMesh` 挂在它下面，
  因此 `instancedMesh.matrixWorld = T(10,0,0)`。

### 移动前：包围球与拾取一致

`computeBoundingSphere()`（`InstancedMesh.js:171-179`）把每个实例的
`geometry.boundingSphere` 用实例局部矩阵变换后取并集：

```
实例 0：球心 (0,0,0)，r=1
实例 1：球心 (4,0,0)，r=1
并集  ⇒  boundingSphere = 球心 (2,0,0)，r=3   （局部空间）
```

拾取时（`InstancedMesh.js:273-274`）再乘 `matrixWorld`，得到**世界空间整体包围球**：
球心 `(12,0,0)`，半径 `3`（覆盖世界 x ∈ [9, 15]）。

发射拾取射线：原点 `(14, 10, 0)`，方向 `(0,-1,0)`（正对实例 1 的世界位置 `(14,0,0)` 垂直向下）。

1. **整体测试**（`InstancedMesh.js:276`）：射线到球心 `(12,0,0)` 的最近距离为 `2 ≤ 3`，通过。
2. **逐实例测试**（`InstancedMesh.js:280-307`）：对每个实例计算
   `_instanceWorldMatrix = matrixWorld × instanceLocalMatrix`，借 `_mesh` 做 `Mesh.raycast`：
   - 实例 0：世界球心 `(10,0,0)`，r=1；射线距离球心 `4 > 1`，未命中。
   - 实例 1：世界球心 `(14,0,0)`，r=1；`Mesh.raycast` 先把射线逆变换到实例局部空间
     （原点变为 `(0,10,0)`），三角形级求交命中球顶局部点 `(0,1,0)`，
     再经 `_instanceWorldMatrix` 变回世界坐标（`Mesh.js:448`）。

**移动前结果**：命中 `instanceId = 1`，世界命中点 `(14, 1, 0)`，距离 `9`。

### 编辑器移动实例 1 之后：渲染与拾取脱节

编辑器执行：

```js
instancedMesh.setMatrixAt( 1, new Matrix4().makeTranslation( 10, 0, 0 ) );
instancedMesh.instanceMatrix.needsUpdate = true;   // 只做了这一步
// 没有调用 instancedMesh.computeBoundingSphere()
```

- **渲染**：`needsUpdate` 让新的实例矩阵上传 GPU，实例 1 被画到世界位置 `(20, 0, 0)`。相机里看得见。✔
- **包围球**：`boundingSphere` 仍是缓存的局部球心 `(2,0,0)`、r=3 —— 它只在
  `=== null` 时才被惰性计算（`InstancedMesh.js:271`、`Frustum.js:152`），
  `setMatrixAt` 不会让它失效。世界空间仍覆盖 x ∈ [9, 15]，**够不到 x=20**。

对新位置发射拾取射线：原点 `(20, 10, 0)`，方向 `(0,-1,0)`。

1. **整体测试**：射线（直线 x=20）到球心 `(12,0,0)` 的最近距离为 `8 > 3`，
   `raycaster.ray.intersectsSphere( _sphere ) === false` → 在 `InstancedMesh.js:276` 直接 `return`。
2. 逐实例循环**根本没有执行**。

**移动后结果**：`intersects` 为空 —— 实例 1 明明画在 `(20,0,0)`，却拾取不到。

### 对照：若移动后重算了包围球

`computeBoundingSphere()` 会得到局部球心 `(5,0,0)`、r=6（实例 0 在 0、实例 1 在 10 的并集），
世界球心 `(15,0,0)`、r=6：

1. 整体测试：射线到 `(15,0,0)` 的距离 `5 ≤ 6`，通过。
2. 逐实例：实例 0（世界 `(10,0,0)`）距离 `10` 未命中；实例 1（世界 `(20,0,0)`，r=1）命中。

**恢复后结果**：命中 `instanceId = 1`，世界命中点 `(20, 1, 0)`，距离 `9` —— 与画面完全一致。

### 附：旧位置不会"幽灵命中"

反向点旧位置 `(14,1,0)`：射线能通过陈旧的整体包围球（距离 2 ≤ 3），但逐实例测试用的是
**当前** `instanceMatrix`（实例 1 已在 x=20），两个实例都未命中，结果仍为空。
这印证了上面的结论：整体包围球只是一道**否决门**，它只能让本该有的命中丢失，
不能凭空制造命中；真正的命中集合永远由逐实例测试（= 当前实例数据）决定。

---

## 2. 两套数据各自的生效时机与恢复一致的条件

### 实例数据（`instanceMatrix`）—— 逐实例射线相交 + 渲染

- **渲染**：GPU 每帧直接消费 `instanceMatrix` 属性缓冲区；`setMatrixAt` 后必须置
  `instanceMatrix.needsUpdate = true` 才会重新上传（`InstancedMesh.js:50-53` 的文档注释）。
- **拾取**：`InstancedMesh.raycast` 的循环里（`InstancedMesh.js:284-286`）每次都用
  `getMatrixAt` 现读实例矩阵，与 `matrixWorld` 相乘后做完整的 `Mesh.raycast`
  （几何包围球粗测 → 射线逆变换到局部 → 三角形级求交 → 命中点变换回世界）。
- 因此**逐实例结果始终与渲染一致**，它是"实时"的，不存在缓存失效问题。
- 注意 `raycastTimes = this.count`（`InstancedMesh.js:262`）：若运行时调小了
  `count`，超出部分的实例既不渲染也不参与拾取。

### 整体界限（`boundingSphere` / `boundingBox`）—— 粗测否决门 + 视锥剔除

- **生效点一（拾取）**：`InstancedMesh.raycast` 开头（`InstancedMesh.js:271-276`），
  整体包围球乘 `matrixWorld` 后与射线求交，不相交则**整组实例全部跳过**。
- **生效点二（剔除）**：`Frustum.intersectsObject`（`Frustum.js:150-154`）用同一个
  `boundingSphere` 做视锥剔除。陈旧包围球完全移出视锥时，整组实例会被错误剔除
  （连"看得见"都会丢失）；本例中旧球仍在视锥内，所以只表现为拾取失效。
- **计算时机**：只在 `boundingSphere === null` 时惰性计算一次（射线拾取或剔除首次
  需要时）。`setMatrixAt` **不会**触发重算，引擎也没有任何自动失效机制 ——
  `computeBoundingSphere` 的文档注释明确写着"You may need to recompute … if an
  instance is transformed via `setMatrixAt`"（`InstancedMesh.js:147-150`），责任在调用方。
- `boundingBox` 同理，且连惰性计算都没有（`computeBoundingBox` 文档：
  "is not automatically computed by the engine"，`InstancedMesh.js:111-114`），
  只有显式调用才存在。

### 父节点/自身变换为什么不需要额外处理

整体包围球存的是 **InstancedMesh 局部空间** 的值，每次测试时现乘 `matrixWorld`
（`InstancedMesh.js:273-274`、`Frustum.js:154`），而 `matrixWorld` 每帧由
`updateMatrixWorld` 刷新。所以移动/旋转/缩放父节点或 InstancedMesh 自身，
拾取与渲染天然一致 —— 会过期的只有"实例矩阵 ↔ 局部包围球"这一层关系。
（半径经 `Sphere.applyMatrix4` 按最大轴缩放放大，非均匀缩放下保守但正确。）

### 动态编辑后恢复一致拾取的条件

编辑器在 `setMatrixAt` 批量修改实例矩阵之后，必须同时满足：

```js
// 1. 渲染一致性：上传新实例矩阵
instancedMesh.instanceMatrix.needsUpdate = true;

// 2. 拾取/剔除一致性：重算整体界限（本例症状的直接修复）
instancedMesh.computeBoundingSphere();
//    若应用层使用了 boundingBox（如自定义碰撞、BoxHelper），一并重算
instancedMesh.computeBoundingBox();
```

要点：

1. **两者缺一不可**：只设 `needsUpdate` → 看得见点不到（本例）；只重算包围球而不设
   `needsUpdate` → 点得到旧位置、画面却是新的（更隐蔽的反向 bug）。
2. 重算包围球是 O(count) 的 CPU 操作，编辑器通常在"一次拖拽操作结束"
   （如 `mouseUp` / `objectChange` 事务提交）时做一次即可，拖拽过程中可暂不维护。
3. 若实例数量 `count` 被调小，无需重算包围球也能保证正确（球只会偏大、保守），
   但调大或移动实例后必须重算。
4. 长期方案：编辑器可在 `setMatrixAt` 的封装里把 `boundingSphere` 置为 `null`，
   利用引擎现有的"`null` 时惰性重算"路径（`InstancedMesh.js:271`）自动恢复，
   代价是下一次拾取/剔除时多一次 O(count) 计算。
