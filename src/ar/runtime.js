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
  // 0-A 실측(2026-08-07)으로 확인: core xr.js에는 run/loadChunk/version/featureFlags/
  // CanvasScreenshot/MediaRecorder만 있고, **XrController(트래킹)는 chunk에 있다.**
  // 따라서 이미지 타겟만 쓰더라도 tracking chunk 로드가 필수다.
  requiredChunks: ['slam'],
  hasSlamChunk: true, // 바이너리에 xr-slam.js 포함
  // 월드 트래킹(SLAM) 사용 여부는 chunk 로드가 아니라 XrController.configure로 토글한다.
  //   true  = 이미지 타겟 단독 (0-B)
  //   false = 월드 트래킹(SLAM) 활성 (0-B2, 필요 판정 시)
  disableWorldTracking: true,
  // §1.3: 바이너리 사용 시 귀속표시 필수. 경로 B(MIT)에서는 false로.
  requiresAttribution: true,
  crossorigin: 'anonymous',
}

// 런타임 스크립트를 주입하고 window.XR8이 준비되면 resolve한다.
// 런타임이 없거나 시간 초과면 reject → 호출부가 DEV 모드로 폴백.
export function loadRuntime(cfg = RUNTIME, timeoutMs = 6000) {
  return injectScript(cfg)
    .then(() => waitForXR8(timeoutMs))
    .then(() => ensureChunks(cfg))
}

// 필수 chunk를 로드한다. XrController 등 트래킹 모듈이 여기 들어있다.
export async function ensureChunks(cfg = RUNTIME) {
  const chunks = cfg.requiredChunks || []
  for (const c of chunks) {
    if (typeof window.XR8.loadChunk !== 'function') {
      throw new Error('XR8.loadChunk 없음 — 런타임 빌드 확인 필요')
    }
    await window.XR8.loadChunk(c)
  }
  return window.XR8
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

// 0-B2 조건부 SLAM: 0-B에서 Pose 변동이 과하다고 판정될 때만 켠다.
// chunk는 이미 로드되어 있으므로(트래킹 모듈이 거기 있음), 여기서는 월드 트래킹만 켠다.
// 경로 B(hasSlamChunk=false)에서는 no-op이며 false를 반환한다.
export function enableWorldTracking(cfg = RUNTIME) {
  if (!cfg.hasSlamChunk) {
    console.warn('[runtime] 현재 경로에 SLAM 없음 (경로 B). 이미지 타겟 단독으로 동작.')
    return false
  }
  cfg.disableWorldTracking = false
  window.XR8.XrController.configure({ disableWorldTracking: false })
  return true
}
