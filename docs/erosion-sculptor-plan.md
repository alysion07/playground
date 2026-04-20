# Erosion Sculptor — 4주 로드맵

CSG로 쌓은 SDF 덩어리를 시간으로 깎는 WebGPU 인터랙티브 아트.

## 비전

사용자는 5종 SDF 프리미티브(sphere/box/torus/capsule/roundBox)를 결합 연산
(union/diff/intersect/smoothUnion)으로 쌓아 초기 형상을 만든다. 그 형상은
Level Set PDE에 의해 시간에 따라 침식·풍화되어 자연스러운 풍화석·돌탑·
조각 같은 결과가 나오고, 사용자는 결과를 GLB·WebM·공유 URL로 내보낸다.

핵심 수식 (Week 2):

```
∂ψ/∂t = −α · κ · |∇ψ|  −  β · w · ∇ψ
```

- ψ : Signed distance scalar field on a 128³ regular grid.
- κ : Mean curvature, computed from second-order finite differences on ψ.
- α : Isotropic erosion strength (curvature flow → smoothing of pointy bits).
- β : Anisotropic wind erosion strength.
- w : Wind direction vector (UI controlled).

곡률 흐름은 mean curvature flow (Mullins-Sekerka 류)로, 작은 양수 곡률 영역
(돌출부)을 빠르게 깎고 음수 곡률 영역(움푹한 곳)은 보호한다 →
풍화석 같은 자연스러운 둥근 형태로 수렴.

## 고정 결정사항 (재논의 금지)

- **렌더러**: WebGPU 직접 사용 (raw `navigator.gpu`). Three.js는 Week 3
  마칭 큐브 메시 디스플레이용으로 dependency만 유지. NodeMaterial /
  WebGPURenderer 추상화는 사용 안 함.
- **셰이더 언어**: WGSL. `.wgsl` 파일은 `?raw` 임포트.
- **UI 프레임워크 없음**: React 안 씀. plain DOM + Tailwind + tweakpane.
- **상태**: zustand vanilla store 1개.
- **WebGL 폴백 없음**: WebGPU 미지원 브라우저는 안내 화면만.

## 4주 계획

### Week 1 — Scaffold + CSG 프리뷰 (이 PR)

**목표**: WebGPU 기반 정적 SDF 레이마칭 프리뷰. CSG 트리 편집 UI. 빌드/테스트
파이프라인 완성.

**범위**
- 모노레포 통합 (`build.mjs`, `index.html`, `README.md`, `CLAUDE.md`)
- `erosion-sculptor/` 토이 디렉터리 + Vite/TS/Tailwind 설정
- `src/core/` SDF 프리미티브 + CSG 자료구조 + WGSL 코드 생성
- `src/render/` raw WebGPU 파이프라인 + raymarch 셰이더
- `src/state/` zustand store
- `src/ui/` tweakpane CSG 빌더 + fps 오버레이
- `src/app/` bootstrap + RAF 루프
- `tests/smoke.test.ts` sdfGen 스냅샷
- `docs/erosion-sculptor-plan.md` (이 문서)

**검증**: 캔버스에 구가 회전 가능하게 렌더, Add Sphere/Box/SmoothUnion 동작,
60fps, 미지원 브라우저 안내 화면.

### Week 2 — ψ 볼륨 + 곡률 흐름 PDE

**목표**: CSG → 128³ r32float 볼륨에 베이크 → 등방 곡률 흐름으로 시간 진행.

**구현 단계**
1. `bake.wgsl` compute shader — sceneSDF를 128³ 그리드에 샘플링.
   - 디스패치: `(16,16,16)` × `(8,8,8)` workgroups.
2. ψ 텍스처: 두 개의 `r32float` 3D texture (ping-pong).
   - `psi_a`, `psi_b` — `STORAGE_BINDING | TEXTURE_BINDING` usage.
3. `curvature_flow.wgsl` compute shader:
   ```wgsl
   // 중앙 차분으로 ∇ψ 계산
   let gx = (psi(x+1,y,z) - psi(x-1,y,z)) * 0.5 / h;
   // 라플라시안 → mean curvature κ
   let lap = (psi(x+1,y,z) + psi(x-1,y,z) + ... - 6*psi(x,y,z)) / (h*h);
   let gradMag = length(vec3(gx, gy, gz));
   let k = lap / max(gradMag, 1e-4);
   psi_b[idx] = psi_a[idx] - dt * alpha * k * gradMag;
   ```
4. 레이마칭 셰이더 변경:
   - 정적 sceneSDF 호출 대신 `psi_a` 3D 텍스처 trilinear 샘플링.
   - 분석적 SDF는 베이크 입력으로만 사용 (런타임 SDF 호출 제거).
5. UI: "▶ Erode" 버튼 → 매 프레임 N 스텝 PDE 진행. "Reset" → 베이크 재실행.

**리스크**
- CFL 안정 조건: `dt < h² / (6α)` 정도. UI에서 자동으로 안전한 dt 선택.
- 128³ × 4byte = 8MB × 2 (ping-pong) = 16MB GPU 메모리. WebGPU 디바이스
  limits 확인 필요.

**검증**: 모서리가 둥글어지고, 작은 돌출이 사라지는 것이 시각적으로 확인되어야.

### Week 3 — 바람 이방성 + Marching Cubes + 라이팅

**목표**: 자연스러운 풍화 + 메시 추출 + PBR 라이팅.

**구현**
1. 바람 항 추가: `−β · dot(w, ∇ψ)`.
   - UI: 바람 방향 (yaw, elevation), 세기 β.
2. **바람 시각화** (등방/이방 침식 구분이 한눈에 보이게):
   - **표면 풍압 셰이딩**: raymarch 셰이더에서 hit normal에 대해
     `pressure = clamp(−dot(n, w), -1, 1)` 계산 → 풍상측 = 따뜻한 빨강,
     풍하측 = 차가운 파랑으로 색 매핑. 머티리얼 베이스 색과 mix(α=0.6)로 합성.
   - **풍향 컴퍼스 위젯**: 캔버스 우상단 작은 SVG 오버레이 — 카메라 기준
     yaw 화살표 + 세기 바. tweakpane 외부 DOM 요소로 둠 (panel과 별개).
   - **토글**: tweakpane "Wind viz" 체크박스 (기본 ON) + `W` 키 단축키.
     OFF면 raymarch에서 풍압 텀이 0배율로 죽어서 순수 머티리얼 색만 나옴.
   - 비용: raymarch.wgsl 마지막 lit 계산에 mix 한 줄, uniform에 wind vec3 + viz
     플래그 1 float 추가. 컴퍼스 위젯은 ~30줄 vanilla SVG.
3. Marching cubes (compute shader):
   - `march.wgsl` — 128³ 셀을 워크그룹별로 처리, vertex/index 버퍼 생성.
   - GPU에서 직접 vertex buffer 빌드 → Three.js `BufferGeometry`로 래핑.
3. Three.js 도입:
   - `WebGPURenderer` 또는 그냥 marching cubes 출력을 raw WebGPU로
     함께 그리기. 후자가 단순.
4. 라이팅: 분석적 normal (Marching cubes 출력 기반) + Lambert + 환경광 +
   triplanar 텍스처로 풍화석 표면 디테일.

**리스크**
- Marching cubes 버텍스 생성은 GPU에서 atomic counter 기반 — WebGPU
  `atomicAdd<storage>` 사용 필요.
- 메시 vertex 수 상한: 128³ 격자에서 최악 2M vertex. 1M 정도로 제한 (decimation).

### Week 4 — 내보내기 + 공유 + 배포

**목표**: GLB / WebM / URL 공유.

**구현**
1. **GLB 내보내기**: marching cubes vertex buffer → `THREE.GLTFExporter`.
2. **WebM 녹화**: `MediaRecorder` + `canvas.captureStream(60)`.
   30초 제한, 720p downsampled.
3. **URL 공유**: CSG 트리 + 침식 파라미터 (α, β, dt, steps) + 카메라를
   `JSON.stringify` → `LZString` 압축 → base64url → URL 해시.
4. **프리셋 5개**: "오벨리스크", "동굴", "바람의 돌", "산호초", "토템".
5. **배포**: Cloudflare Pages — `playground/dist/erosion/` 자동 배포.

**리스크**
- WebM 녹화는 Chrome/Edge만 안정적, Safari는 mp4 fallback 필요.
  → v1엔 WebM only, "Safari 지원 예정" 안내.

## 폴더 구조 (4주 완료 시점)

```
erosion-sculptor/
  src/
    core/
      sdfPrim.ts          (week 1) 5종 프리미티브 schema
      csg.ts              (week 1) 트리 자료구조 + JSON
      sdfGen.ts           (week 1) Node → WGSL 코드 생성
      bake.ts             (week 2) SDF → ψ 볼륨 베이크
      mc.ts               (week 3) marching cubes 호출 래퍼
    render/
      renderer.ts         (week 1) WebGPU init
      camera.ts           (week 1) 오빗 카메라
      material.ts         (week 1) raymarch 파이프라인
      pdePass.ts          (week 2) 곡률 흐름 compute pass
      mcPass.ts           (week 3) marching cubes compute pass
      meshPipeline.ts     (week 3) 추출된 메시 렌더 파이프라인
      shaders/
        common.wgsl       (week 1)
        raymarch.wgsl     (week 1)
        bake.wgsl         (week 2)
        curvature_flow.wgsl (week 2)
        march.wgsl        (week 3)
        lit_mesh.wgsl     (week 3)
    state/
      types.ts            (week 1)
      store.ts            (week 1)
      url-sync.ts         (week 4)
    ui/
      csg-builder.ts      (week 1)
      fps-overlay.ts      (week 1)
      erode-controls.ts   (week 2) Erode/Reset 버튼, α/dt
      wind-controls.ts    (week 3) 바람 방향/세기
      export-panel.ts     (week 4) GLB/WebM/Share
    app/
      bootstrap.ts        (week 1)
      loop.ts             (week 1)
    util/
      resize.ts           (week 1)
      pointer.ts          (week 1)
      lz.ts               (week 4) LZString 래퍼
    main.ts               (week 1)
  tests/
    smoke.test.ts         (week 1) sdfGen 스냅샷
    csg.test.ts           (week 2) JSON round-trip
    bake.test.ts          (week 2) 베이크 결과 검증 (CPU 시뮬레이션 비교)
```

## 다음 세션 핸드오프

Week 2를 시작할 때:
1. 이 문서 Week 2 섹션을 출발점으로.
2. `src/core/sdfGen.ts`의 출력은 그대로 Week 2 베이크 compute의 입력으로 사용.
3. `src/render/material.ts`는 폐기하지 말고, 베이크된 ψ 볼륨을 트라이리니어
   샘플링하는 새 파이프라인으로 교체.
4. ping-pong 패턴의 stable한 참조 구현: WebGPU samples - "compute boids" 또는
   "particle system" 예제.

Week 3 시작 시:
1. Three.js를 처음 본격 도입. r170+의 `BufferGeometry` API로 GPU buffer 래핑.
2. 만약 `three/webgpu` 도입 시 build 깨지면 r0.180+로 즉시 bump.
