// ─────────────────────────────────────────────────────────────────────────
// 런타임 어댑터 — 경로 A ↔ B 이음매 (스펙 §3.3)
//
// 앱의 나머지 코드는 오직 이 어댑터가 resolve하는 window.XR8만 만진다.
// 경로 A(Distributed Engine Binary, XR Engine License)와 경로 B(MIT 소스 빌드)는
// 아래 RUNTIME config만 다르고 앱 코드는 불변이다. → A로 개념검증, 이후 B로 확장.
//
// 전환 방법(A→B):
//   1) url을 MIT 빌드 산출물 경로로 교체
//   2) requiresAttribution = false (MIT는 귀속표시 불필요)
//   3) hasSlamChunk = false (MIT 빌드엔 닫힌 SLAM 미포함)
//   그 외 파이프라인/정합박스/계측/셰이더 코드는 그대로.
// ─────────────────────────────────────────────────────────────────────────

export const RUNTIME = {
  // 현재: 경로 A — Niantic Distributed Engine Binary
  path: 'A',
  // 런타임 로드: 공식 CDN(jsdelivr, @8thwall/engine-binary)에서 직접 로드한다.
  //   - 우리가 재배포하지 않고 Niantic 공식 배포를 원형 그대로 사용 → 라이선스상 가장 깨끗
  //   - GitHub Pages 배포에서 바이너리를 git에 안 올려도 동작
  //   - slam/face chunk도 같은 CDN 베이스에서 지연 로드됨
  // self-host로 바꾸려면 '/xr8/xr.js'로 교체(public/xr8/에 벤더링, git 제외).
  url: 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js',
  // SLAM은 조건부(0-B2): 기본은 preload 안 함. 필요 판정 시 ensureSlam()로 지연 로드.
  preloadChunks: [],
  hasSlamChunk: true, // 바이너리에 xr-slam.js 포함 → ensureSlam() 사용 가능
  // §1.3: 바이너리 사용 시 귀속표시 필수. 경로 B(MIT)에서는 false로.
  requiresAttribution: true,
  crossorigin: 'anonymous',
}

// 런타임 스크립트를 주입하고 window.XR8이 준비되면 resolve한다.
// 런타임이 없거나 시간 초과면 reject → 호출부가 DEV 모드로 폴백.
export function loadRuntime(cfg = RUNTIME, timeoutMs = 6000) {
  return injectScript(cfg).then(() => waitForXR8(timeoutMs))
}

function injectScript(cfg) {
  return new Promise((resolve, reject) => {
    if (window.XR8) return resolve()
    const s = document.createElement('script')
    s.src = cfg.url
    s.async = true
    if (cfg.crossorigin) s.crossOrigin = cfg.crossorigin
    // 엔진은 co-located chunk를 data-preload-chunks 또는 loadChunk로 로드한다.
    if (cfg.preloadChunks && cfg.preloadChunks.length) {
      s.setAttribute('data-preload-chunks', cfg.preloadChunks.join(' '))
    }
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`runtime load failed: ${cfg.url}`))
    document.head.appendChild(s)
  })
}

// XR8은 스크립트 로드 후 비동기로 준비된다. window.XR8 또는 'xrloaded'를 기다린다.
function waitForXR8(timeoutMs) {
  return new Promise((resolve, reject) => {
    if (window.XR8) return resolve(window.XR8)
    let done = false
    const finish = (fn, arg) => {
      if (done) return
      done = true
      clearInterval(poll)
      clearTimeout(timer)
      fn(arg)
    }
    window.addEventListener('xrloaded', () => finish(resolve, window.XR8), { once: true })
    const poll = setInterval(() => {
      if (window.XR8) finish(resolve, window.XR8)
    }, 100)
    const timer = setTimeout(() => finish(reject, new Error('XR8 준비 시간 초과')), timeoutMs)
  })
}

// 0-B2 조건부 SLAM: 0-B에서 Pose 변동이 과하다고 판정될 때만 호출한다.
// 경로 B(hasSlamChunk=false)에서는 no-op이며 false를 반환한다.
export async function ensureSlam(cfg = RUNTIME) {
  if (!cfg.hasSlamChunk) {
    console.warn('[runtime] 현재 경로에 SLAM chunk 없음 (경로 B). 이미지 타겟 단독으로 동작.')
    return false
  }
  await window.XR8.loadChunk('slam')
  return true
}
