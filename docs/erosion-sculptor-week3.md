# Erosion Sculptor — Week 3 세부 플랜

> 전제: Week 1(CSG 정적 프리뷰)과 Week 2(ψ 볼륨 + 곡률 흐름 PDE)는 이미
> 동작한다. 이 문서는 그 위에 **바람 이방성 + 바람 시각화 + Marching Cubes
> 메시 + 메시 라이팅**을 얹는 Week 3의 실행 계획이다.
> 4주 전체 맥락은 `docs/erosion-sculptor-plan.md` 참고.

---

## 1. 목표 / 완료 정의

- ψ 진화식이 완전한 형태 `∂ψ/∂t = −α·κ·|∇ψ| − β·dot(w(p), ∇ψ)` 로 확장되어,
  β 슬라이더를 올리면 풍상측이 빠르게 깎이고 풍하측이 남는다.
- 화면 우상단 작은 SVG 컴퍼스로 현재 바람 yaw/세기가 보이고, raymarch 표면에
  풍압 색(빨강 풍상 / 파랑 풍하)이 머티리얼과 mix되어 나온다. `W` 키 + tweakpane
  토글로 on/off.
- "Mesh" 버튼을 누르면 Marching Cubes compute pass가 현재 ψ에서 메시를 추출해
  Lambert + triplanar 라이팅으로 렌더된다. raymarch 프리뷰와 메시 표시는
  **배타 토글** (동시 표시는 v2).
- 메시 vertex 상한 1M. 초과 시 overflow 플래그를 띄우고 grid를 낮추라는 안내.
- 새 테스트: `tests/wind.step.test.ts`, `tests/mc.test.ts` — 둘 다
  `erode.step.test.ts` 스타일의 CPU 레퍼런스 기반.

---

## 2. 의존 그래프

```
Step 1 (state: WindParams 슬라이스)
   └─> Step 2 (erode.wgsl 확장 + 바람 항 + 균일 w + 노이즈 변조)
         └─> Step 5 (wind.step.test.ts)
         └─> Step 3 (raymarch.wgsl 풍압 셰이딩)
               └─> Step 4 (SVG 컴퍼스 위젯 + W 키)
Step 6 (march.wgsl + meshPipeline.ts) — ψ만 있으면 되므로 1/2/3과 독립
   └─> Step 7 (lit_mesh.wgsl + Lambert/triplanar + render toggle)
         └─> Step 5 (mc.test.ts — CPU MC 레퍼런스 비교)
```

- Step 2가 풀리면 바람 관련 UI/시각화/테스트가 모두 동시에 진행 가능하다.
- Step 6 (MC)은 Step 1~5와 병렬로 가도 된다. ψ 텍스처 포맷은 Week 2에서
  이미 확정되어 있으므로 블로킹 없음.
- Step 7은 Step 6 결과 버퍼가 있어야 렌더링이 되므로 반드시 뒤.

---

## 3. 단계별 구현 순서

### Step 1 — `WindParams` 슬라이스 추가

**만질 파일**
- `src/state/types.ts` — 새 `WindParams` 타입 + `RootState.wind` 필드 추가.
- `src/state/store.ts` — `DEFAULT_WIND`, `setWind` 헬퍼.

**스키마**

```ts
export type WindParams = {
  beta: number;       // 바람 세기 계수. 0 이면 wind 항 완전 OFF
  yaw: number;        // 수평각 [0, 2π)
  elevation: number;  // 수직각 [−π/2, π/2]
  noise: number;      // 바람 방향 공간 변조 진폭 [0, 1]
  viz: boolean;       // 표면 풍압 색칠 + SVG 컴퍼스 표시
};
export const DEFAULT_WIND: WindParams = {
  beta: 0.0, yaw: 0.3, elevation: 0.0, noise: 0.25, viz: true,
};
```

**왜 yaw/elevation 별도**: 사용자는 3D 벡터가 아닌 "어느 방향에서 부는지"로
생각한다. 셰이더에 넘길 때 `w = vec3(cos(el)cos(yaw), sin(el), cos(el)sin(yaw))`
로 변환한다. noise는 Step 2에서 쓴다.

**검증**: 슬라이더 흔들 때 store dump 확인. 저장 스키마 버전은 아직 안 올림
(url-sync는 Week 4).

---

### Step 2 — `erode.wgsl` 확장: 바람 항 + 절차적 노이즈

**결정 1 (wind.wgsl 분리 vs erode.wgsl 확장)** → **erode.wgsl 확장**.
- 이유: 곡률 항과 바람 항은 모두 `∇ψ`가 필요해 FD 로드(7 샘플)를 공유한다.
  별도 셰이더로 두면 중간 텍스처 + 두 번 dispatch + 50% 코드 중복이
  생기고, 수식은 그냥 합이므로 한 번에 쓰는 게 더 PDE에 가깝다.
- 결과: 파일명 유지, 유니폼에 바람 필드 추가. `wind_flow.wgsl` 파일은 만들지
  않는다 (plan.md의 폴더 구조에서 해당 라인 제거).

**결정 2 (바람 필드 자료구조)** → **균일 vec3 + 절차적 value noise 변조**.

| 옵션 | 메모리 | 유연성 | 구현비용 | 결정 |
| --- | --- | --- | --- | --- |
| 균일 vec3 uniform | 0 | 낮음 (방향 하나) | 0 | ❌ 단조로움 |
| 3D 텍스처 (r32float × 3) | 128³×12 = 24 MB × 1 | 최고 | 높음 (생성/관리) | ❌ Week 3 범위 초과 |
| 균일 + value noise (셰이더) | 0 | 중간 (기본 방향 + 변조) | 낮음 | ✅ |

세이더 내 value noise: `hash3(floor(p*freq))` 기반 vec3 offset을 base 방향에
`mix(base, base + noiseDir, wind.noise)` 로 섞음. 공간 변조 빈도는 상수
`WIND_NOISE_FREQ = 2.5` (world 단위). noise=0 이면 정확히 균일 방향.

**WGSL 변경 (개략)**

```wgsl
struct ErodeU {
  alpha: f32, dt: f32, beta: f32, windNoise: f32,
  windDir: vec3<f32>, _pad: f32,
};

// ... existing gx/gy/gz, lap, H 계산 ...

let w = windFieldAt(worldPos);         // base + noise 변조
let advect = dot(w, vec3(gx, gy, gz)); // β · w · ∇ψ
let next = c + alpha * dt * H * gradMag - beta * dt * advect;
```

**만질 파일**
- `src/render/shaders/erode.wgsl` — `ErodeU` 유니폼 확장, `windFieldAt` 함수
  추가, wind advection 항 추가.
- `src/render/material.ts` — `erodeBuffer` 사이즈 16 → 32 byte,
  `runErodeStep` 시그니처에 wind 파라미터 수용 (`beta`, `windDir`, `windNoise`).
- `src/sim/scheduler.ts` — `tickPde` 가 `WindParams` 를 읽어 `runErodeStep`
  에 전달. CFL clamp 는 `max(α, β)` 기준으로 재계산 (wind 항도 확산 유사
  안정성 제약을 가지므로 보수적으로).

**CFL 재검토**: 바람 항은 순수 advection → upwind-스킴이 아닌 centered
difference 쓰면 엄밀하게는 불안정. 하지만 동시에 곡률(확산) 항이 존재하므로
확산-보정된 CFL `dt < h² / (3α + 2β·h)` 로 근사. 실전에서 α≫β·h 구간에서만
쓸 거라 기존 `dt < h²/(3α)` 를 유지하고 UI에 "β is advection — use sparingly"
경고 정도만.

**검증**: 
- β=0 이면 기존 곡률 흐름과 픽셀 단위로 동일 결과 (회귀 테스트).
- β>0, α=0 이면 구의 중심이 바람 방향으로 평행이동 (등속).
- α,β>0 이면 풍상측이 빠르게 깎임.

---

### Step 3 — `raymarch.wgsl` 풍압 셰이딩

**만질 파일**
- `src/render/shaders/raymarch.wgsl` — `CamU` 뒤에 `WindU` 유니폼 추가
  (아래 섹션 4 참고), hit 분기에 풍압 색 mix 로직 삽입.
- `src/render/material.ts` — `windBuffer` 새 uniform buffer, raymarch BGL에
  바인딩 3 추가. `writeWindUniforms(wind: WindParams)` 메서드.
- `src/app/loop.ts` — 프레임마다 wind slice 를 셰이더 uniform으로 flush.

**풍압 매핑**

```wgsl
// hit 직후 lit 계산 블록 내
let pressure = clamp(-dot(n, W.dir), -1.0, 1.0);  // +1 풍상, -1 풍하
let warm = vec3<f32>(0.95, 0.30, 0.22);
let cool = vec3<f32>(0.22, 0.40, 0.95);
let pColor = select(cool, warm, pressure > 0.0);
let pMag = abs(pressure);
let mixAmount = W.viz * pMag * 0.6;  // viz ∈ {0,1}
let tinted = mix(base, pColor, mixAmount);
// tinted 를 기존 lit 계산의 base 로 사용
```

viz=0 이면 `mixAmount` 가 0이라 순수 머티리얼 색. 셰이더에는 토글이 float로
들어와 branch 없이 mix 로 처리.

**검증**: β=0, viz=1 로 바람 방향만 바꾸면 구 표면의 빨강/파랑 띠가 회전.
viz=0 이면 사라짐.

---

### Step 4 — SVG 컴퍼스 + `W` 키 토글

**만질 파일**
- `src/ui/wind-compass.ts` (신규) — 캔버스 상단 HTMLElement에 SVG 주입.
  폭 80px, 우상단 고정 (`position: absolute; top: 12px; right: 12px`).
  store 구독으로 yaw/β 변화에 따라 화살표 rotate + 세기 바 길이 업데이트.
- `src/ui/csg-builder.ts` — 새 "Wind" 폴더 추가:
  - `beta` slider (0 … 1.2 step 0.01)
  - `yaw` slider (0 … 2π)
  - `elevation` slider (−π/2 … π/2)
  - `noise` slider (0 … 1)
  - `viz` checkbox
- `src/app/bootstrap.ts` — document.addEventListener('keydown', …): 키가
  `w`/`W` 이고 modifier 없고 `document.activeElement` 가 INPUT/TEXTAREA 아닐
  때만 `setWind({ viz: !state.wind.viz })`.

**결정 3 ('W' 키 충돌)**: `util/pointer.ts` 는 pointer/wheel만 듣고 키보드는
안 건드린다. Tweakpane 입력 필드에서 타이핑 중이 아닌 경우에만 W 키를 토글로
해석하면 안전. 같은 전역 키 핸들러에 추후 G(그리드), P(재생) 같은 것을 붙일
여지 남김.

**결정 5 (Wind viz 토글 상태 위치)**: 위 스키마대로 `WindParams.viz` 에 둠.
이유: 바람 관련 파라미터 묶음의 일관성이 우선. RenderParams.wireframe 같은
순수 출력 토글이 아니라 바람 기능의 일부 UI 상태이므로.

**검증**: 토글 시 즉시 색이 껐다 켜짐. 컴퍼스가 yaw 변경에 반응.

---

### Step 5 — 테스트: `wind.step.test.ts` + `mc.test.ts`

Step 2/6 와 병행해 TDD 스타일로 작성 권장.

#### `tests/wind.step.test.ts`

`erode.step.test.ts` 패턴을 그대로 미러. CPU 함수가 WGSL line-for-line:

```ts
function erodeWindStepCPU(psi, N, h, alpha, beta, dt, wx, wy, wz) {
  // ... bake sphere, central-diff ∇ψ, Laplacian, H 계산 (기존과 동일) ...
  const advect = gx*wx + gy*wy + gz*wz;
  next[idx] = c + alpha*dt*H*gradMag - beta*dt*advect;
}
```

테스트 3개:
1. **β=0 등가성**: β=0으로 돌린 결과가 기존 `erodeStepCPU` 와 bit-exact 동일.
2. **순수 advection**: α=0, β=0.5, w=(1,0,0). 600 step 후 초기 구의 중심이
   `+x` 축으로 `β·t` 만큼 이동했는지 (±1 voxel).
3. **이방 침식 대칭 깨짐**: α=0.4, β=0.3, w=(1,0,0). 풍상측(+x) 반경이
   풍하측(−x)보다 더 줄어드는지 측정 (`measureRadiusPlusX` + `measureRadiusMinusX`).

#### `tests/mc.test.ts`

단위 sphere 레벨셋(R=0.6)을 직접 Float32Array 로 bake → CPU MC 레퍼런스 →
sanity check. CPU MC 는 full MC lookup table 을 구현하기보단 **Surface Nets**
(dual contouring 간이판) 으로 충분하다. 이유: Week 3 MC 결과 sanity 만 확인
하면 되고, 정확한 삼각형 topology 비교가 아닌 점이 표면 근처인지만 체크하면
됨.

테스트 2개:
1. **구 vertex 수 > 0**, **모든 vertex가 unit sphere 근처**: 각 vertex
   `|length(v) - R| < 1.5 h`.
2. **빈 볼륨**: ψ 가 전부 +1 이면 vertex 수 0.

GPU MC 출력 검증은 vitest에서 어렵다 (WebGPU 없음). → 브라우저 e2e 로 별도
수동 체크 (Week 4 Playwright 도입 시에 자동화 고려).

---

### Step 6 — Marching Cubes compute pass

**결정 6 (Three.js 도입)** → **Week 3 런타임 사용 보류**.
- 이유: Three.js `BufferGeometry` 는 WebGL/WebGPU backend 에 묶인 추상이라,
  raw WebGPU 파이프라인에 쓰려면 internal buffer 핸들을 뽑아내야 해서 오히려
  복잡. Week 3 은 순수 raw WebGPU 렌더 파이프라인 (`meshPipeline.ts`) 로
  메시를 그린다. Three.js는 Week 4 에서 GLTFExporter 때문에 처음 import한다.
  `package.json` dependency 로만 유지 (plan.md 고정 결정사항과 일치).
- 번들 사이즈: tree-shaking 된 core import 대비 raw WebGPU 유지 시 0. 향후
  Week 4 에서 `BufferGeometry`, `BufferAttribute`, `GLTFExporter` 만 개별
  import 하면 ~50 KB gz 으로 억제 가능.

**만질 파일**
- `src/render/shaders/march.wgsl` (신규) — compute shader.
- `src/render/mcPass.ts` (신규) — pipeline + atomic counter 버퍼 + vertex/index
  버퍼 소유자. CPU readback 금지.
- `src/core/mc.ts` (신규) — MC 255-case lookup table 을 WGSL const 배열로
  내보내는 빌드 헬퍼 (또는 large `@group(1) @binding(0)` storage buffer).
  파이선 스크립트로 생성 대신 TS 에서 상수 배열 export.
- `src/sim/scheduler.ts` — "Mesh" 버튼으로 들어오는 `pendingMeshBuild` 플래그
  (PdeState 에 추가) 를 drain 해서 MC dispatch.
- `src/state/types.ts`, `store.ts` — `pendingMeshBuild: boolean`,
  `meshVertexCount: number`, `meshOverflow: boolean` 추가.

**결정 4 (MC 워크그룹 디스패치 전략)**: **셀당 1스레드, 단일 패스**.
- 128³ × workgroup (4,4,4) → 32³ = 32 768 workgroups. (N=96 이면 24³ = 13 824,
  N=64 이면 16³ = 4 096.)
- vertex buffer 사전 할당: **최대 1M vertex** (96 byte × 1M = 96 MB 는 너무
  크다 — 실제로는 pos vec3 + normal vec3 = 24 byte, 24 MB). index buffer
  1M u32 = 4 MB. 합 28 MB 로 budget 을 맞춤.
- atomic counter 로 각 셀이 자기 triangle 개수만큼 slot 을 예약해 쓴다
  (`atomicAdd(&counter.vertexCount, 15u)` 후 해당 offset 에 write).
- overflow 처리: 예약된 offset 이 버퍼 끝을 넘으면 write 스킵 + 별도 flag
  storage buffer 에 bit 세트. CPU 가 dispatch 후 읽어서 `meshOverflow=true`
  → UI 경고 띄움.
- 1M 상한 근거: 극단적으로 dense 한 형상에서 128³ 중 ~5% 셀이 non-trivial
  이고 셀당 평균 5 tri ≈ 12 vertex. 128³ × 5% × 12 ≈ 983K → 1M 로 넉넉.
- dispatch 강도: 32³ workgroup × 64 thread = 2M thread, ψ sample 이 8점 ×
  셀당 1번이라 bandwidth bound. 모바일 Adreno 기준 10~20 ms 예상 → PDE
  재생 중에는 N step 마다 한 번만 MC 돌려도 됨 (매 프레임 X).

**march.wgsl 개략 (binding 스펙은 섹션 4)**

```wgsl
@compute @workgroup_size(4, 4, 4)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  // 1. 셀 8 모서리 ψ 샘플 → cubeIndex
  // 2. edgeTable[cubeIndex] 로 자를 edge bitmask 결정
  // 3. 각 edge 에서 선형보간으로 vertex pos + normal 생성
  // 4. triTable[cubeIndex] 순회하며 atomicAdd 로 slot 확보 후 store
}
```

**검증**
- CPU MC 레퍼런스(단위구 Surface Nets) 와 vertex 개수가 ±10% 이내.
- UI "Mesh" 버튼 누르면 raymarch 사라지고 wireframe 메시가 보임 (shading 은
  Step 7). overflow 시 빨간 경고.

---

### Step 7 — 메시 라이팅 (Lambert + triplanar)

**만질 파일**
- `src/render/shaders/lit_mesh.wgsl` (신규) — vertex + fragment.
- `src/render/meshPipeline.ts` (신규) — render pipeline + depth buffer attach.
- `src/render/renderer.ts` — 렌더 모드에 따라 fullscreen raymarch 파이프라인
  vs 메시 파이프라인 택일 실행. 두 파이프라인이 같은 color target + depth
  target 을 쓰도록 정리.
- `src/state/types.ts`, `store.ts` — `RenderParams.mode: 'raymarch' | 'mesh'`.
- `src/ui/csg-builder.ts` — Render 폴더에 mode select 추가.

**결정 7 (raymarch vs MC 동시 표시 시 깊이)**: **v1 배타 토글**.
- 이유: 깊이 합성하려면 raymarch fs 에서 `@builtin(frag_depth)` 로 hit 점의
  NDC depth 를 직접 write 해야 하고, 카메라 매트릭스 없이 z 만 직접 계산
  해야 한다. 가능하지만 추가 코드이고 UX 가치는 제한적.
- 토글 UX: Render.mode radio ("Raymarch preview" / "Mesh"). "Mesh" 누르면
  직전 ψ 스냅샷에서 MC 한 번 실행 후 메시 표시. 재생 중 메시로 바꿔도
  자동 재추출 없음 (명시적 Rebuild 버튼).
- v2 로 미루는 것: 두 모드 동시 표시 (반투명 메시 + raymarch 뒤).

**triplanar 텍스처**

```wgsl
fn triplanar(p: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
  let blend = normalize(pow(abs(n), vec3<f32>(4.0)));
  let wsum = blend.x + blend.y + blend.z;
  let bw = blend / wsum;
  let cx = stoneNoise(p.yz);  // procedural — 실제 텍스처 샘플러 없이
  let cy = stoneNoise(p.zx);
  let cz = stoneNoise(p.xy);
  return cx * bw.x + cy * bw.y + cz * bw.z;
}
```

`stoneNoise` 는 value-noise 3옥타브 fbm. 실제 이미지 텍스처 로딩은 Week 3 제외
(Week 4 에서 프리셋과 함께 에셋 파이프라인 도입 시 고려).

**라이팅**

```wgsl
let ambient = vec3<f32>(0.18, 0.20, 0.24);
let ndl = max(dot(n, lightDir), 0.0);
let albedo = triplanar(worldPos, n) * vec3<f32>(0.78, 0.62, 0.48);
let lit = albedo * (ambient + ndl * vec3<f32>(0.95, 0.92, 0.85));
let pressure = ...;  // Step 3 와 동일 — 바람 viz 공유
```

**검증**: 구 메시에 암부/양지 구분이 보이고, triplanar 노이즈가 방향 의존성
없이 uniform 하게 분포. vertex normal 은 march.wgsl 출력 사용.

---

## 4. 셰이더 인터페이스 명세

### 4.1 확장된 `erode.wgsl` (Step 2)

**Bind group 0** (기존 그대로 + Uniform 확장):

| Binding | Resource | Type | 변경 |
| --- | --- | --- | --- |
| 0 | `GeomU` | uniform | 유지 |
| 1 | `ErodeU` | uniform | **32 byte 로 확장** |
| 2 | `psi_in` | texture_3d\<f32\> | 유지 |
| 3 | `psi_out` | texture_storage_3d\<r32float, write\> | 유지 |

**ErodeU 레이아웃 (std140 정렬)**

```wgsl
struct ErodeU {
  alpha: f32,      // 0  isotropic curvature-flow 강도
  dt: f32,         // 4
  beta: f32,       // 8  wind advection 강도 (0 이면 비활성)
  windNoise: f32,  // 12 절차적 노이즈 변조 진폭
  windDir: vec3<f32>, // 16..28  base 풍향 (단위벡터)
  _pad: f32,       // 28..32
};
// 총 32 byte
```

CPU 쪽 `writeBuffer` 에 넘기는 Float32Array 는 8개 원소:
`[alpha, dt, beta, noise, wx, wy, wz, 0]`.

**Workgroup**: `@workgroup_size(4, 4, 4)` — 기존 유지.

### 4.2 `raymarch.wgsl` (Step 3)

**Bind group 0** (기존 + WindU 추가):

| Binding | Resource | Type |
| --- | --- | --- |
| 0 | `CamU` | uniform (80 byte) |
| 1 | `GeomU` | uniform |
| 2 | `psi` | texture_3d\<f32\> |
| **3** | **`WindU`** | **uniform (32 byte) — 신규** |

**WindU 레이아웃**

```wgsl
struct WindU {
  dir: vec3<f32>,   // 0..12   단위 풍향 (camera basis 기준이 아닌 world)
  viz: f32,         // 12..16  토글 {0, 1}
  noise: f32,       // 16..20  (raymarch 에는 현재 안 쓰지만 공용으로 예약)
  _pad0: f32,       // 20..24
  _pad1: f32,       // 24..28
  _pad2: f32,       // 28..32
};
// 총 32 byte
```

`WindU` 는 `erode.wgsl` 의 `ErodeU` 와는 별개 버퍼. 매 프레임 CPU에서
`WindParams` → `{dir, viz, noise}` 로 변환해 write. 단일 버퍼로 공유 가능하지만
가시성(erode 는 COMPUTE, raymarch 는 FRAGMENT)과 업데이트 빈도가 달라 분리.

### 4.3 `march.wgsl` (Step 6)

**Bind group 0**:

| Binding | Resource | Type |
| --- | --- | --- |
| 0 | `GeomU` | uniform (ψ 지오메트리) |
| 1 | `psi` | texture_3d\<f32\> (읽기) |
| 2 | `vertexBuf` | storage\<array\<Vertex\>, read_write\> |
| 3 | `indexBuf` | storage\<array\<u32\>, read_write\> |
| 4 | `counter` | storage\<Counter, read_write\> |
| 5 | `tables` | storage\<LookupTables, read\> (edge + tri) |

```wgsl
struct Vertex {
  pos: vec3<f32>,     // 12
  _p0: f32,           // 16
  normal: vec3<f32>,  // 28
  _p1: f32,           // 32
};  // 32 byte stride

struct Counter {
  vertexCount: atomic<u32>,
  indexCount: atomic<u32>,
  overflow: atomic<u32>,  // 0 또는 1. any-write 로 충분.
};

struct LookupTables {
  edgeTable: array<u32, 256>,     // 각 cubeIndex 의 edge bitmask
  triTable: array<i32, 256 * 16>, // 최대 15 edge 인덱스 + sentinel -1
};
```

**Workgroup**: `@workgroup_size(4, 4, 4)` — erode 와 통일. Dispatch 는
`ceil((N-1)/4)` (셀 격자는 voxel 격자보다 한 칸 작음).

**버퍼 할당 (mcPass.ts)**

```ts
const MAX_VERTS = 1_000_000;
const MAX_INDICES = 1_000_000;
const vertexBuf = device.createBuffer({
  size: MAX_VERTS * 32, // 32 MB
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
});
const indexBuf = device.createBuffer({
  size: MAX_INDICES * 4, // 4 MB
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC,
});
const counterBuf = device.createBuffer({
  size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
});
```

매 MC dispatch 전 counter 를 0으로 초기화 (writeBuffer 4 byte ×3).

### 4.4 `lit_mesh.wgsl` (Step 7)

- Vertex stage: vertex buffer layout `pos.xyz + pad + normal.xyz + pad` (stride 32).
- Fragment stage: 위 Step 7 참고.
- Bind group 0:
  - `@binding(0)` `CamU` (raymarch 것과 동일 구조 재사용)
  - `@binding(1)` `WindU` (풍압 viz 공유)

---

## 5. 테스트 전략

CPU 레퍼런스는 **WGSL 라인을 그대로 복사** 해 작성한다 (`erode.step.test.ts`
패턴). 부동소수점 비트 정확성이 아닌, "같은 수식을 CPU 에서 돌렸을 때 나오는
수렴 동작이 물리적으로 맞는가" 를 본다.

### 검증할 수식

| 수식 / 성질 | 테스트 | 허용 오차 |
| --- | --- | --- |
| β=0 이면 Week 2 곡률 흐름과 동일 | `wind.step.test.ts #1` | bit-exact |
| α=0, β>0: 순수 advection → 구 중심이 `β·t·|w|` 이동 | `#2` | < 1 voxel |
| α>0, β>0: 풍상측 반경 < 풍하측 반경 | `#3` | > 2 voxel diff |
| MC vertex 수 > 0 (비어있지 않은 volume) | `mc.test.ts #1` | — |
| MC vertex 모두 `|length(v)-R| < 1.5h` | `#1` | 1.5 voxel |
| MC 빈 volume → vertex 수 0 | `#2` | — |

GPU 경로의 실제 동작은 수동 브라우저 스모크로 확인 (Week 4 의 Playwright 에서
자동화 후보로 기록).

---

## 6. 리스크 + 완화책

1. **바람 항의 numerical dispersion**: centered difference 는 순수 advection
   에 대해 이론상 unstable. 곡률 항의 diffusion 이 이를 안정화해주지만 α≪β 구간
   에서는 oscillation 가능. 
   **완화**: β 슬라이더 max 를 1.2 로 제한하고, UI 에 "α 가 β 보다 큰 게
   권장" 툴팁. 진짜 문제가 되면 Week 4 에서 upwind 스킴으로 교체.

2. **MC vertex overflow**: dense + 고해상도 형상에서 1M 초과 가능.
   **완화**: overflow flag 읽어서 UI 에 "메시가 잘렸습니다. grid 낮추거나
   침식 더 진행하세요" 띄움. 잘린 메시는 정확하지 않지만 렌더 가능.

3. **march.wgsl lookup table 업로드 비용**: 256×16 i32 = 16 KB, 1회만
   업로드하면 되니 실제 비용은 무시 가능.

4. **atomic contention**: 셀 격자에서 수많은 스레드가 동시에 `atomicAdd`.
   Adreno/Mali 계열에서 serialized atomic 경로가 느려 수십 ms 찍힐 수 있음.
   **완화**: 이번 주는 measurements → 뚜껑 열고 문제면 Week 4에서
   prefix-sum 2-pass 로 개선.

5. **WindParams 추가로 url-sync 스키마 깨짐 (Week 4)**: 지금은 url-sync 미구현
   이라 상관없지만, Week 4 때 SCHEMA_VERSION 을 올려야 함. 이 문서에 흔적
   남겨둠.

6. **Three.js pre-emptive 도입 유혹**: 원래 plan 에 Week 3 도입이라고 쓰여
   있지만, 실제로 import 없이도 raw WebGPU 메시 파이프라인이 더 단순하다.
   **완화**: 이 결정을 섹션 3/Step 6 에 기록. Week 4 첫 커밋에서 Three.js
   도입.

7. **`W` 키가 브라우저 기본 동작/접근성 도구와 충돌**: Ctrl+W 는 탭 닫기
   (modifier 필터로 해결). 스크린 리더는 single-key 를 가로채지 않음.
   **완화**: tweakpane 필드에 focus 있을 때 skip (섹션 3/Step 4).

8. **CFL 재클램프가 β 변화에 반응 안 함**: scheduler.cflMaxDt 는 α 만
   본다. Step 2 에서 signature 를 `(h, α, β)` 로 넓히되 실전 영향이 작으면
   구현 미룸 — 주석으로 남김.

---

## 7. Out of Scope (Week 4로)

- **GLB / WebM / URL 공유 내보내기** — Week 4의 전담.
- **raymarch + mesh 동시 표시 (반투명 합성)** — frag_depth 직접 쓰기 필요,
  UX 가치 제한적.
- **3D 텍스처 기반 진짜 공간 가변 바람 필드** — 24 MB × 1 추가 할당, 노이즈
  생성 compute pass 필요. 현재의 procedural value noise 로 감각적으로 충분.
- **Upwind advection scheme** — 필요해지면 Week 4 리팩터.
- **MC prefix-sum 2-pass 최적화** — atomic 가 실제로 느릴 때만.
- **이미지 기반 triplanar 텍스처** — Week 4 프리셋 에셋 파이프라인과 함께.
- **URL state 버전 관리** — Week 4 url-sync 도입 시.
- **모바일 fps 프로파일링** — Week 4 배포 전.

---

## 핸드오프 메모

Week 3 시작 시:
1. `docs/erosion-sculptor-plan.md` 의 폴더 구조에서 `wind_flow.wgsl` 라인은
   제거 (통합 결정 반영).
2. Step 1 → Step 2 → Step 5 (wind test) → Step 3/4 → Step 6 → Step 5 (mc test)
   → Step 7 순서가 의존성 기준 안전한 경로.
3. Three.js 첫 import 는 Week 4 첫 PR 에서. 지금은 dependency 만 유지.
4. 모든 신규 WGSL 는 `?raw` import, workgroup_size (4,4,4) 고정.
