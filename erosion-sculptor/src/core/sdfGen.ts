import type { CsgNode, Vec3 } from '../state/types';
import { PRIM_SCHEMAS } from './sdfPrim';

// Format a number with stable WGSL-friendly precision.
function f(n: number): string {
  if (!Number.isFinite(n)) return '0.0';
  // Always emit a decimal so WGSL parses as f32, never int.
  const s = n.toFixed(6);
  // Trim trailing zeros but keep at least one fractional digit.
  return s.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '.0');
}

function vec3(v: Vec3): string {
  return `vec3<f32>(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;
}

// Apply translate+rotate (Euler XYZ) to the local sample point.
// rotate=0 produces an identity rotation that simplifies to a pure translate.
function emitLocalPoint(rootP: string, translate: Vec3, rotate: Vec3): string {
  const translated = `(${rootP} - ${vec3(translate)})`;
  const isZero = rotate[0] === 0 && rotate[1] === 0 && rotate[2] === 0;
  if (isZero) return translated;
  // Build inverse Euler rotation by negating angles and applying Z*Y*X (inverse
  // of XYZ Euler). Inlined as 3x3 since matrix construction is verbose in WGSL.
  const cx = f(Math.cos(-rotate[0]));
  const sx = f(Math.sin(-rotate[0]));
  const cy = f(Math.cos(-rotate[1]));
  const sy = f(Math.sin(-rotate[1]));
  const cz = f(Math.cos(-rotate[2]));
  const sz = f(Math.sin(-rotate[2]));
  // Standard intrinsic XYZ: R = Rz * Ry * Rx. Inverse rotates by negative
  // angles in reverse order, but with R(-θ) = R(θ)^T the explicit transpose
  // form is simpler. We just inline the resulting matrix elements.
  return (
    `(mat3x3<f32>(` +
    `${cy}*${cz}, ${cy}*${sz}, -${sy}, ` +
    `${sx}*${sy}*${cz} - ${cx}*${sz}, ${sx}*${sy}*${sz} + ${cx}*${cz}, ${sx}*${cy}, ` +
    `${cx}*${sy}*${cz} + ${sx}*${sz}, ${cx}*${sy}*${sz} - ${sx}*${cz}, ${cx}*${cy}` +
    `) * ${translated})`
  );
}

type GenCtx = {
  varCount: number;
  lines: string[];
};

function nextVar(ctx: GenCtx): string {
  return `n${ctx.varCount++}`;
}

function emit(node: CsgNode, ctx: GenCtx, rootP: string): string {
  if (node.kind === 'prim') {
    const schema = PRIM_SCHEMAS[node.type];
    const localP = emitLocalPoint(rootP, node.translate, node.rotate);
    const lp = nextVar(ctx);
    ctx.lines.push(`  let ${lp}: vec3<f32> = ${localP};`);
    const params = node.params.map(f);
    const expr = schema.emit(lp, params);
    const v = nextVar(ctx);
    ctx.lines.push(`  let ${v}: f32 = ${expr};`);
    return v;
  }
  // op node
  if (node.children.length === 0) {
    // No children → arbitrary far value so the scene stays empty.
    const v = nextVar(ctx);
    ctx.lines.push(`  let ${v}: f32 = 1e9;`);
    return v;
  }
  let acc = emit(node.children[0], ctx, rootP);
  for (let i = 1; i < node.children.length; i++) {
    const next = emit(node.children[i], ctx, rootP);
    const out = nextVar(ctx);
    switch (node.op) {
      case 'union':
        ctx.lines.push(`  let ${out}: f32 = min(${acc}, ${next});`);
        break;
      case 'diff':
        // A - B  →  max(A, -B)
        ctx.lines.push(`  let ${out}: f32 = max(${acc}, -(${next}));`);
        break;
      case 'intersect':
        ctx.lines.push(`  let ${out}: f32 = max(${acc}, ${next});`);
        break;
      case 'smoothUnion': {
        const k = f(node.k);
        ctx.lines.push(`  let ${out}: f32 = smin(${acc}, ${next}, ${k});`);
        break;
      }
    }
    acc = out;
  }
  return acc;
}

// Generate the body of the CSG SDF function. Internal helper — exposed for
// tests. Production callers should use `generateSceneSDF` which wraps the body
// in the canonical `sdCsg` function signature shared by raymarch + init shaders.
export function generateSceneSDFBody(root: CsgNode): string {
  const ctx: GenCtx = { varCount: 0, lines: [] };
  const rootVar = emit(root, ctx, 'p');
  ctx.lines.push(`  return ${rootVar};`);
  return ctx.lines.join('\n');
}

// Full WGSL function definition. Both the raymarch (Week 1) and the volume
// init compute (Week 2) reference `sdCsg(p)`; emitting the function once and
// substituting it into each shader template keeps a single source of truth
// for CSG → SDF translation.
export function generateSceneSDF(root: CsgNode): string {
  return `fn sdCsg(p: vec3<f32>) -> f32 {\n${generateSceneSDFBody(root)}\n}`;
}
