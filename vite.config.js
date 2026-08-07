import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// 빌드 식별자. 자산 URL 캐시버스팅과 화면 스탬프에 함께 쓴다.
const BUILD_ID = new Date().toISOString().slice(11, 19)

// 캐시 전략 (배포 트러블슈팅 결과):
//   GitHub Pages는 HTML과 자산을 모두 max-age=600(10분) 캐시한다.
//   - 파일명에 해시를 쓰면: 캐시된 옛 HTML이 삭제된 해시 파일을 가리켜 404 → 백지
//   - 파일명을 고정만 하면: 고정 파일이 10분간 캐시되어 옛 JS가 계속 실행됨
//   → 해법은 둘의 조합: 경로는 고정하고, HTML의 참조에 ?v=BUILD_ID 쿼리를 붙인다.
//     옛 HTML이 캐시돼도 경로가 유효하고(404 없음), 새 HTML은 새 쿼리로 최신 JS를 받는다.
const BUILD_TAG = BUILD_ID.replace(/:/g, '') // URL 쿼리용 (콜론 제거)
const cacheBust = () => ({
  name: 'cache-bust-assets',
  transformIndexHtml(html) {
    return html
      .replace(/(src="\/WebARtest\/assets\/[^"]+\.js)"/g, `$1?v=${BUILD_TAG}"`)
      .replace(/(href="\/WebARtest\/assets\/[^"]+\.css)"/g, `$1?v=${BUILD_TAG}"`)
  },
})

// 카메라 접근은 보안 컨텍스트(HTTPS 또는 localhost)에서만 허용된다.
// 폰으로 LAN에서 접속해 실측하려면 HTTPS가 필수이므로 dev 서버에 자체 서명 인증서를 켠다.
export default defineConfig({
  // GitHub Pages 프로젝트 사이트는 https://<user>.github.io/WebARtest/ 로 서빙된다.
  // 절대 base로 고정해야 끝 슬래시 없는 주소(.../WebARtest)로 열어도 자산 경로가
  // github.io 루트로 새지 않는다.
  base: '/WebARtest/',
  // 빌드 식별자: 화면에 찍어 "지금 보는 게 새 빌드인가 캐시인가"를 눈으로 구분한다.
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    rollupOptions: {
      output: {
        // 파일명 고정(해시 없음) — 위 캐시 전략 참고.
        // 동적 import 청크는 HTML을 거치지 않아 캐시버스팅이 안 걸리므로,
        // 코드 분할 없이 단일 번들로 만든다(three가 어차피 공통이라 손해 없음).
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [cacheBust(), basicSsl()],
  server: {
    host: true, // 0.0.0.0 바인딩 → 같은 Wi-Fi의 폰에서 접속 가능
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
})
