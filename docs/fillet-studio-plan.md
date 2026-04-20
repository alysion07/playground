# Fillet Studio — Plan

정확한 geometric data processing + 프론트엔드 아키텍처 쇼케이스용 토이.

## Goal

"Sharp CSG 조립 → 지정한 반지름 R로 정확하게 라운딩된 필렛 → 3D 프린트·CAD 호환 메시 내보내기"를
전부 브라우저에서 시연. Metaball-playground가 "예쁨"이라면 이건 "정확함".

## Design principles

- **수학 검증 가능성**: 곡률 흐름 PDE의 closed-form 해 (구 수축 `R² = R₀² − 2αt`)를
  integration test로 고정 — 회귀 방지선.
- **Pure + I/O 분리**: `core/`는 전부 순수 함수. Three/React/zustand는 바깥 껍질.
- **CPU-only**: WebGPU compute는 다음 토이(`erosion-sculptor`)에 맡기고, 여기는 매스/UX만.
- **일관된 bbox 규약**: `voxelSize = 2·extents / (N−1)` → 복셀 0과 N−1이 정확히
  `±extents`에 위치, 원점이 `(N-1)/2`에 얹힘.

## Phases

| Phase | 내용 | 상태 |
|-------|------|------|
| 1 | scaffold: Vite + React + TS + zustand + Three + vitest | ✅ |
| 2 | `core/` 순수 모듈: types, csg 트리, 프리미티브 SDF, 컴파일러, 샘플링 | ✅ |
| 3 | curvature flow PDE + R-cap + Neumann 경계 (+ 5 tests) | ✅ |
| 4 | marching cubes (Bourke 테이블, edge dedup, gradient 노멀) (+ 4 tests) | ✅ |
| 5 | render pipeline: scene + Viewport + meshFromField | ✅ |
| 6 | zustand store + UI 패널 (CSG 트리 / 필렛 / 내보내기) | ✅ |
| 7 | GLB (GLTFExporter) + STL (binary, 직접 인코드) (+ 2 tests) | ✅ |
| 8 | 갤러리 등록 (build.mjs + index.html) + 문서 | ✅ |

## Tests

총 **26개** 통과:

- `csg` (6) — 트리 불변식, updateAt/removeNode/addChild
- `sdfCpu` (9) — 프리미티브·회전·CSG 연산의 수치 정확성
- `curvatureFlow` (5) — 구 수축 closed-form 검증, 코너 라운딩 정성 성질
- `marchingCubes` (4) — 빈 메시, 구 watertight + 면적 ≈ 4πr², 해상도 수렴, 노멀 방향
- `stl` (2) — 바이너리 레이아웃 + 페이스 노멀 복원

## Future (not in v1)

- 워커 오프로드 (현재는 `setTimeout(0)`로 메인 스레드 양보)
- URL로 CSG 트리 직렬화/공유
- 내로우밴드 최적화 (전체 볼륨 대신 `|ψ| < band` 영역만 업데이트)
- 스크린샷/프리뷰 카드 자동 생성
