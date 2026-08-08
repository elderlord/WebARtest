import * as THREE from 'three'
import { createAlignmentBox } from './alignmentBox.js'
import { Metrics, FpsMeter } from './metrics.js'
import { createShaderSmokeTest } from './shaderSmokeTest.js'
import { showBanner, createSizeTuner } from '../hud.js'
import { RUNTIME } from './runtime.js'

// 8th Wall XR8 카메라 파이프라인 위에 three.js 씬을 얹고,
// 이미지 타겟 인식 시 정합 박스를 타겟에 부착한다. (0단계 계측 하네스)
//
// 전제:
//   - window.XR8 런타임이 로드되어 있어야 한다 (CDN 또는 self-host, public/xr8 참고)
//   - 이미지 타겟은 image-target-cli로 컴파일해 public/targets/에 배치하고
//     manifest.json에 이름을 등록하면 런타임에 자동 로드된다.
//
// 참고 API (0-A 실측 + image-target-cli README 확인):
//   XR8.XrController.configure({ imageTargetData: [<컴파일된 target json>] })
//   reality.imagefound/imageupdated/imagelost, XR8.Threejs.pipelineModule()/xrScene()

// 타겟 매니페스트: 빌드에 타겟이 없어도 앱이 동작해야 하므로 런타임에 fetch한다.
// public/targets/manifest.json 예: { "targets": ["poster"] }
// 각 타겟은 public/targets/<name>.json (+ <name>_luminance.png)로 배치한다.
const TARGETS_DIR = 'targets'

// 진단 출력용 짧은 수치 포맷
const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) < 100 ? v.toFixed(3) : v.toFixed(1)) : '?')

// 컴파일된 타겟들을 로드한다. 없으면 빈 배열(0-A 모드: 카메라만).
export async function loadImageTargets(base = import.meta.env.BASE_URL || '/') {
  const dir = `${base}${TARGETS_DIR}`
  try {
    const res = await fetch(`${dir}/manifest.json`, { cache: 'no-cache' })
    if (!res.ok) return []
    const { targets = [] } = await res.json()
    const loaded = await Promise.all(
      targets.map(async (entry) => {
        // 매니페스트 항목은 문자열 또는 { name, widthMm } 객체를 허용한다.
        // widthMm(실물 가로 폭)이 있으면 world scale calibration(스펙 §6.2)에 쓴다.
        const name = typeof entry === 'string' ? entry : entry.name
        const widthMm = typeof entry === 'object' ? entry.widthMm : undefined
        const r = await fetch(`${dir}/${name}.json`, { cache: 'no-cache' })
        if (!r.ok) throw new Error(`타겟 로드 실패: ${name}`)
        const data = await r.json()
        if (widthMm) data.widthMm = widthMm
        // imagePath는 CLI 기본값이 'image-targets/..'이므로 실제 서빙 경로로 교정한다.
        const file = String(data.imagePath || '').split('/').pop()
        data.imagePath = `${dir}/${file}`
        if (!data.name) data.name = name
        return data
      })
    )
    return loaded
  } catch (e) {
    console.warn('[webar] 이미지 타겟 없음/로드 실패 → 카메라만 실행:', e)
    return []
  }
}

// opts.shaderSmokeTest: true면 0-A 셰이더 스모크 테스트 모듈을 파이프라인에 추가한다.
//   (?smoke 쿼리로 켜는 것을 권장 — 아래 startXr8 호출부에서 판단)
export function startXr8({ canvas, hud, shaderSmokeTest = false, imageTargets = [] } = {}) {
  const XR8 = window.XR8
  // 인식 대상 이름 집합 (여러 패널 확장 대비). 비어 있으면 카메라만(0-A 모드).
  const targetNames = new Set(imageTargets.map((t) => t.name).filter(Boolean))
  // 타겟별 실물 폭(mm) — 엔진 단위를 미터로 환산하는 데 쓴다(스펙 §6.2)
  const widthMmByName = new Map(imageTargets.filter((t) => t.widthMm).map((t) => [t.name, t.widthMm]))
  // 엔진 1단위 = 몇 m 인가. imagefound에서 scaledWidth와 실물 폭을 비교해 정한다.
  let metersPerUnit = null
  let rawInfo = 'raw –'
  // 0-B 측정 누적값: 인식 성공 최대 거리(peak hold), 재획득 횟수
  let maxDistCm = 0
  let reacquireCount = 0
  let everFound = false
  // 정합 배율 k — 엔진 크기 규약이 후보 공식과 정확히 맞지 않아 실물에 맞춰 읽는다.
  // 마지막 imagefound 값을 보관해 k 변경 시 즉시 다시 그린다.
  let sizeK = 1
  let lastDetail = null
  const box = createAlignmentBox()
  const metrics = new Metrics(30)
  const fps = new FpsMeter()

  // 타겟이 마지막으로 보고한 실측 크기 (imagefound/updated에서 갱신)
  let lastWidth = 1
  let lastHeight = 1

  const attachBox = (detail) => {
    const { position, rotation, scale, scaledWidth, scaledHeight, name } = detail
    // 엔진 원시값을 화면에 노출한다. disableWorldTracking 모드에서는 좌표가
    // 미터가 아닐 수 있어(0-B 실측), 규약을 눈으로 확인한 뒤 환산한다.
    const wMm = widthMmByName.get(name)
    const sForCal = typeof scale === 'number' && scale > 0 ? scale : 1
    if (wMm && scaledWidth) metersPerUnit = wMm / 1000 / (scaledWidth * sForCal * sizeK)
    rawInfo =
      `raw sw=${fmt(scaledWidth)} sh=${fmt(scaledHeight)} scale=${fmt(scale)}` +
      ` k=${sizeK.toFixed(3)}` +
      (metersPerUnit ? ` · 1u=${(metersPerUnit * 100).toFixed(1)}cm` : '')
    box.position.copy(position)
    box.quaternion.copy(rotation)
    // 스케일 규약 (0-B 실측으로 확정, 스펙 §6.3 정정):
    // 실제 타겟 크기 = scaledWidth·scale × scaledHeight·scale.
    // scaledWidth/Height는 정규화 치수(높이=1)이고 scale이 실제 배율이다.
    if (scaledWidth && scaledHeight) {
      const s = typeof scale === 'number' && scale > 0 ? scale : 1
      lastWidth = scaledWidth * s * sizeK
      lastHeight = scaledHeight * s * sizeK
      box.resize(lastWidth, lastHeight)
    }
    lastDetail = detail
    box.visible = true
  }

  const imageTargetModule = () => ({
    name: 'panel-alignment',
    onStart: () => {
      const { scene } = XR8.Threejs.xrScene()
      scene.add(box)
    },
    // 매 프레임: 계측값 갱신
    onUpdate: () => {
      const now = performance.now()
      hud.setFps(fps.tick(now))
      if (box.visible) {
        const { camera } = XR8.Threejs.xrScene()
        const m = metrics.update(box.position, box.quaternion, camera)
        // metrics는 "1단위=1m"를 가정한다. calibration이 잡히면 실제 배율로 보정.
        if (metersPerUnit) {
          m.distanceCm *= metersPerUnit
          m.poseVarMm *= metersPerUnit
        }
        // 인식에 성공한 상태에서의 최대 거리를 계속 갱신한다
        // (= 이 거리까지는 인식이 유지된다는 실측 기록)
        if (m.distanceCm > maxDistCm) {
          maxDistCm = m.distanceCm
          hud.setMaxDistance(maxDistCm)
        }
        hud.setMetrics(m)
        hud.setDebug(rawInfo)
      }
    },
    listeners: [
      {
        event: 'reality.imagefound',
        process: ({ detail }) => {
          if (!targetNames.has(detail.name)) return
          if (everFound) hud.setReacquire(++reacquireCount)
          everFound = true
          metrics.reset()
          attachBox(detail)
          hud.setFound(true)
        },
      },
      {
        event: 'reality.imageupdated',
        process: ({ detail }) => {
          if (!targetNames.has(detail.name)) return
          attachBox(detail)
        },
      },
      {
        event: 'reality.imagelost',
        process: ({ detail }) => {
          if (!targetNames.has(detail.name)) return
          box.visible = false
          metrics.reset()
          hud.setFound(false)
        },
      },
    ],
  })

  // XR8.Threejs 파이프라인 모듈은 전역 window.THREE를 요구한다(0-A 실측 확인).
  // 우리는 three를 ES 모듈로 번들하므로 전역에 노출해 준다.
  if (!window.THREE) window.THREE = THREE

  // 이 빌드에서 파이프라인 모듈이 다른 이름일 수 있다. 없으면 어느 것이 없는지 명확히 보고.
  const need = ['GlTextureRenderer', 'Threejs', 'XrController']
  const missing = need.filter((k) => !XR8[k] || typeof XR8[k].pipelineModule !== 'function')
  if (missing.length) {
    throw new Error(`XR8 모듈 없음: ${missing.join(', ')} · 사용가능 키: ${Object.keys(XR8).join(',')}`)
  }

  const modules = [
    XR8.GlTextureRenderer.pipelineModule(), // 카메라 피드를 캔버스에 렌더
    XR8.Threejs.pipelineModule(), // three.js 씬 관리
    XR8.XrController.pipelineModule(), // 트래킹 (SLAM은 조건부: runtime.enableWorldTracking)
  ]

  // 이미지 타겟은 컴파일된 타겟이 실제로 로드됐을 때만 등록한다.
  // 타겟이 없으면(0-A) 카메라+HUD만 띄운다.
  const hasRealTarget = targetNames.size > 0
  if (hasRealTarget) modules.push(imageTargetModule())

  // 0-A 셰이더 스모크 테스트 (?smoke): 카메라 텍스처 셰이더 접근 판정
  if (shaderSmokeTest) {
    modules.push(
      createShaderSmokeTest({
        onResult: ({ pass, note }) =>
          showBanner(`<b>셰이더 스모크: ${pass ? 'PASS' : 'FAIL'}</b><br>${note}`),
      })
    )
  }

  XR8.addCameraPipelineModules(modules)

  // 0-B는 이미지 타겟 단독(disableWorldTracking: true). SLAM은 0-B2에서
  // runtime.enableWorldTracking()으로만 켠다.
  XR8.XrController.configure({ disableWorldTracking: RUNTIME.disableWorldTracking })

  if (hasRealTarget) {
    // image-target-cli 산출 JSON을 그대로 주입한다 (README 확인).
    XR8.XrController.configure({ imageTargetData: imageTargets })
    // 정합 배율 튜너: 박스가 실물 테두리와 정확히 겹칠 때까지 k를 맞춘 뒤
    // 그 k 값을 알려주면 크기 공식을 확정한다.
    createSizeTuner({
      onChange: (k) => {
        sizeK = k
        if (lastDetail) attachBox(lastDetail)
      },
    })
    showBanner(
      `<b>0-B 정합 배율 맞추기</b> — ±버튼으로 초록 박스를 실물 테두리에 정확히 맞추고,` +
        ` 화면의 <b>k 값</b>을 알려주세요.`
    )
  } else {
    // 타겟 없이 카메라만: HUD에 0-A 상태 표시
    hud.setFound(false)
    showBanner(
      `<b>0-A 런타임 OK</b> — XR8 로드·카메라 기동. 타겟 미등록(사진 대기).<br>` +
        `<code>?smoke</code>로 셰이더 접근 판정.`
    )
  }

  // 캔버스 드로잉 버퍼를 뷰포트에 맞춘다.
  // XRExtras.FullWindowCanvas를 쓰지 않으므로 직접 처리해야 한다. 이걸 안 하면
  // 버퍼가 기본 300x150이라 카메라 피드가 화면 일부에만 그려진다(0-A 실측 확인).
  const fitCanvas = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(window.innerWidth * dpr)
    const h = Math.round(window.innerHeight * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    // three 렌더러가 이미 있으면 함께 갱신
    const scene = XR8.Threejs.xrScene && XR8.Threejs.xrScene()
    if (scene && scene.renderer) {
      scene.renderer.setSize(window.innerWidth, window.innerHeight, false)
    }
  }
  fitCanvas()
  window.addEventListener('resize', fitCanvas)
  window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 200))

  XR8.run({ canvas })
}
