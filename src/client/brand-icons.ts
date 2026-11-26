/**
 * Brand marks for the tools the rules panel can list.
 *
 * Vendored bytes, never hot links: the vendor logo URLs are build-hashed and rotate, so each
 * mark below is a copy of the official file as fetched on 2026-11-23 (exact URL per icon).
 * `body` is the inner markup of the source <svg>, for
 *   <svg viewBox={viewBox} dangerouslySetInnerHTML={{ __html: body }} />
 * The source width/height attributes are dropped so the caller owns the box; the source
 * viewBox is kept verbatim, so the aspect ratio never changes.
 *
 * Minification: whitespace and attribute-quote noise only. No defs, fills, gradients, filters
 * or styles were removed. Marks whose body exceeded ~2.5 KB also had coordinate digits
 * trimmed (see the per-icon note); opacity and gradient-stop values keep at least 2 decimals
 * and blur radii at least 1, so nothing changes shape or transparency. Gradient, filter and
 * clipPath ids are renamed with the icon key as a prefix so two marks in one document cannot
 * collide.
 *
 * Provenance and licensing: these are third-party brand marks. They remain the property of
 * their owners and are used here only to identify the corresponding tool. simple-icons is
 * CC0-1.0 as packaging; the marks themselves belong to their owners.
 */

export interface BrandIcon {
  readonly viewBox: string;
  readonly title: string;
  readonly body: string;
}

export const BRAND_ICONS: Readonly<Record<string, BrandIcon>> = {
  // CodeBuddy — official vendor logo.
  // Source: https://download.codebuddy.cn/web/website/7b25e1f24385a28a7c133de175ff1dc2bc6b455e/assets/logo.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 4186 B; body 2489 B; own background plate: yes.
  // Renamed ids: clip0_5110_14771 -> codebuddyClip0, filter0_f_5110_14771 -> codebuddyBlur0, filter1_f_5110_14771 -> codebuddyBlur1, paint0_linear_5110_14771 -> codebuddyFill0, paint1_linear_5110_14771 -> codebuddyFill1.
  'codebuddy': {
    viewBox: '0 0 40 40',
    title: 'CodeBuddy',
    body: '<g clip-path="url(#codebuddyClip0)"><rect width="40" height="40" rx="20" fill="url(#codebuddyFill0)"/>' +
      '<g filter="url(#codebuddyBlur0)"><circle cx="13" cy="35" r="14" fill="#32E6B9" fill-opacity="0.4"/></g>' +
      '<g filter="url(#codebuddyBlur1)"><circle cx="33" cy="44" r="13" fill="#32E6B9"/></g>' +
      '<path d="M28 3C28 3 28 3 28 3C29 3 29 3 30 4C31 5 34 8 35 11L36 12L36 12C37 12 38 13 39 14C39 14 39 14 ' +
      '39 14C40 13 42 14 43 15C44 16 45 18 46 20C46 20 46 21 46 21C46 23 46 24 45 24C45 24 45 24 45 25C45 27 ' +
      '44 29 43 32C41 34 39 36 36 39C34 40 30 43 28 43C24 45 20 46 17 46C15 46 13 45 12 44C11 44 11 44 11 ' +
      '44C10 44 8 43 6 42C6 41 5 39 4 39C4 37 4 35 5 34C5 33 5 33 5 33C5 32 5 31 5 30L5 30L4 28C2 25 1 22 1 ' +
      '21C1 20 1 19 1 19C1 19 2 18 2 18C4 18 7 18 11 19L11 19L12 18C14 17 15 16 16 15C18 14 20 13 23 12L23 ' +
      '12L24 11C25 7 27 4 28 3ZM15 23C14 24 13 25 12 25C10 27 9 31 10 34C10 35 11 35 12 37C13 39 13 40 14 ' +
      '40C16 43 19 44 22 42C23 42 24 42 26 41L35 35C37 34 38 34 38 33C41 31 42 28 41 25C40 24 40 23 39 21C38 ' +
      '20 37 19 37 18C35 16 31 15 28 16C27 16 27 17 25 18L15 23Z" fill="url(#codebuddyFill1)"/>' +
      '<rect x="16" y="30" width="4" height="8" rx="2" transform="rotate(-30 15.8816 30.0273)" fill="white"/>' +
      '<rect x="27" y="24" width="4" height="8" rx="2" transform="rotate(-30 26.6978 23.7812)" fill="white"/>' +
      '</g><defs><filter id="codebuddyBlur0" x="-15" y="7" width="55" height="55" filterUnits="userSpaceOnUse" ' +
      'color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/>' +
      '<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>' +
      '<feGaussianBlur stdDeviation="6.7" result="effect1_foregroundBlur_5110_14771"/></filter>' +
      '<filter id="codebuddyBlur1" x="9" y="20" width="48" height="48" filterUnits="userSpaceOnUse" ' +
      'color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/>' +
      '<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>' +
      '<feGaussianBlur stdDeviation="5.5" result="effect1_foregroundBlur_5110_14771"/></filter>' +
      '<linearGradient id="codebuddyFill0" x1="20" y1="0" x2="20" y2="40" gradientUnits="userSpaceOnUse">' +
      '<stop stop-color="#6C4DFF"/><stop offset="1" stop-color="#583ED3"/></linearGradient>' +
      '<linearGradient id="codebuddyFill1" x1="15" y1="11" x2="32" y2="41" gradientUnits="userSpaceOnUse">' +
      '<stop stop-color="white" stop-opacity="0.8"/><stop offset=".44" stop-color="white"/></linearGradient>' +
      '<clipPath id="codebuddyClip0"><rect width="40" height="40" rx="20" fill="white"/></clipPath></defs>',
  },
  // CodeBuddy (intranet) — simple-icons 16.38.1 CodeBuddy glyph; the intranet build has no separate mark.
  // Source: https://cdn.jsdelivr.net/npm/simple-icons@16.38.1/icons/codebuddy.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 1051 B; body 950 B; own background plate: no.
  'codebuddy-intranet': {
    viewBox: '0 0 24 24',
    title: 'CodeBuddy (intranet)',
    body: '<path d="M18.636.289a1 1 0 0 0-.11 0c-.18.01-.195.02-.442.24-.716.636-1.722 2.546-2.703 ' +
      '5.137l-.274.72-.499.16c-1.554.498-2.934 1.128-4.157 1.893-1.174.73-1.81 1.207-2.768 ' +
      '2.056l-.578.51-.262-.045c-2.528-.447-4.8-.612-5.843-.43-.414.077-.757.216-.862.35-.092.12-.138.263-.138.' +
      '474 0 .182.034.414.098.727.265 1.236.952 2.854 2.035 4.78l.7 1.236-.023.466c-.027.499 0 1.27.06 ' +
      '1.793.036.319.031.327-.135.516-.565.647-.708 1.676-.408 ' +
      '2.84h5.364l-.33-.57c-.64-1.108-.96-1.663-1.134-2.177a5.46 5.46 0 0 1 1.564-5.84c.408-.358.962-.678 ' +
      '2.072-1.32l6.38-3.683c1.11-.64 1.665-.96 2.18-1.134A5.46 5.46 0 0 1 24 ' +
      '10.275V6.462l-.117-.06-.504-.25-.357-.662c-.924-1.702-2.41-3.696-3.477-4.666-.4-.364-.655-.517-.91-.535M' +
      '11.57 17.634a1.26 1.26 0 0 1 1.722.462l1.358 2.35c.842 1.455-1.341 2.717-2.183 1.262l-1.358-2.352a1.26 ' +
      '1.26 0 0 1 .461-1.722m6.802-3.926a1.26 1.26 0 0 1 1.721.46l1.358 2.352c.84 1.455-1.343 2.715-2.183 ' +
      '1.26l-1.358-2.35a1.26 1.26 0 0 1 .462-1.722"/>',
  },
  // Cursor — official vendor favicon.
  // Source: https://cursor.com/favicon.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 4190 B; body 2524 B; own background plate: yes.
  // The plate ring is a stroke-only shape in the source and the badge paints every glyph with
  // fill: currentColor, which would fill that ring and hide the plate and the cube under it, so
  // the shape declares fill="none" for itself.
  'cursor': {
    viewBox: '0 0 512 512',
    title: 'Cursor',
    body: '<path d="m512 325.5c0 7.1 0 14.2 0 21.4 0 6-.1 12-.3 18-.4 13.1-1.1 26.2-3.4 39.2-2.4 13.1-6.2 ' +
      '25.3-12.3 37.2-6 11.7-13.7 22.4-23 31.7-9.3 9.3-20 17.1-31.7 23-11.9 6.1-24.1 9.9-37.2 12.3-12.9 ' +
      '2.3-26.1 3.1-39.2 3.4-6 .2-12 .2-18 .3-7.1 0-14.2 0-21.4 0h-139c-7.1 0-14.2 0-21.4 0-6 ' +
      '0-12-.1-18-.3-13.1-.4-26.2-1.1-39.2-3.4-13.1-2.4-25.3-6.2-37.2-12.3-11.7-6-22.4-13.7-31.7-23-9.3-9.3-17.' +
      '1-20-23-31.7-6.1-11.9-9.9-24.1-12.3-37.2-2.3-12.9-3.1-26.1-3.4-39.2-.2-6-.2-12-.3-18 0-7.1 0-14.2 ' +
      '0-21.4v-139c0-7.1 0-14.2 0-21.4 0-6 .1-12 .3-18 .4-13.1 1.1-26.2 3.4-39.2 2.4-13.1 6.2-25.3 12.3-37.2 ' +
      '6-11.7 13.7-22.4 23-31.7 9.3-9.3 20-17.1 31.7-23 11.9-6.1 24.1-9.9 37.2-12.3 12.9-2.3 26.1-3.1 39.2-3.4 ' +
      '6-.2 12-.2 18-.3 7.1 0 14.2 0 21.4 0h139c7.1 0 14.2 0 21.4 0 6 0 12 .1 18 .3 13.1 .4 26.2 1.1 39.2 3.4 ' +
      '13.1 2.4 25.3 6.2 37.2 12.3 11.7 6 22.4 13.7 31.7 23 9.3 9.3 17.1 20 23 31.7 6.1 11.9 9.9 24.1 12.3 ' +
      '37.2 2.3 12.9 3.1 26.1 3.4 39.2 .2 6 .2 12 .3 18 0 7.1 0 14.2 0 21.4v139z" fill="#14120b"/>' +
      '<path d="m186.5 4h139c7.1 0 14.2 0 21.3 0 6 0 12 .1 17.9 .3h0c13 .4 25.9 1.1 38.6 3.4 12.8 2.3 24.6 6 ' +
      '36.1 11.9v0c11 5.6 21.1 12.8 29.8 21.5l.8 .8c9 9 16.5 19.4 22.3 30.7v0c5.7 11.2 9.4 22.6 11.7 34.9l.2 ' +
      '1.2c2.1 11.8 2.9 23.9 3.3 36.1l.1 2.4c.2 6 .2 11.9 .3 17.9v0c0 7.1 0 14.2 0 21.3v129.3l0 0v9.7c0 7.1 0 ' +
      '14.2 0 21.3 0 6-.1 12-.3 17.9v0c-.4 13-1.1 25.9-3.4 38.6-2.2 12.4-5.8 23.9-11.4 35l-.5 1.1c-5.8 ' +
      '11.3-13.3 21.7-22.3 30.7-9 9-19.4 16.5-30.7 22.3-11.5 5.9-23.3 9.6-36.1 11.9-11.8 2.1-23.9 2.9-36.1 ' +
      '3.3l-2.4 .1c-6 .2-11.9 .2-17.9 .3h0c-7.1 0-14.2 0-21.3 0h-139c-7.1 0-14.2 0-21.3 0-6 ' +
      '0-12-.1-17.9-.3h0c-13-.4-25.9-1.1-38.6-3.4-12.8-2.3-24.6-6-36.1-11.9h0c-11-5.6-21.1-12.8-29.8-21.5l-.8-.' +
      '8c-8.7-8.7-16.1-18.7-21.7-29.6l-.5-1.1-.5-1.1c-5.4-10.8-8.9-21.9-11.1-33.8l-.2-1.2c-2.3-12.6-3-25.6-3.4-' +
      '38.6v0c-.2-6-.2-11.9-.3-17.9 0-7.1 0-14.2 0-21.3v-139c0-7.1 0-14.2 0-21.3 0-6 .1-12 .3-17.9v0c.4-13 ' +
      '1.1-25.9 3.4-38.6 2.3-12.8 6-24.6 11.9-36.1l0 0c5.8-11.3 13.3-21.7 22.3-30.7 9-9 19.4-16.5 30.7-22.3 ' +
      '11.5-5.9 23.3-9.6 36.1-11.9 11.8-2.1 24-2.9 36.1-3.3l2.4-.1c6-.2 11.9-.2 17.9-.3l0 0c7.1 0 14.2 0 21.3 ' +
      '0z" fill="none" stroke="#edecec" stroke-opacity=".2" stroke-width="8"/>' +
      '<path d="m415 156.3-151.5-87.5c-4.9-2.8-10.9-2.8-15.7 0l-151.5 87.5c-4.1 2.4-6.6 6.7-6.6 11.5v176.4c0 ' +
      '4.7 2.5 9.1 6.6 11.5l151.5 87.5c4.9 2.8 10.9 2.8 15.7 0l151.5-87.5c4.1-2.4 6.6-6.7 ' +
      '6.6-11.5v-176.4c0-4.7-2.5-9.1-6.6-11.5zm-9.5 18.5-146.3 253.3c-1 1.7-3.6 ' +
      '1-3.6-1v-165.9c0-3.3-1.8-6.4-4.6-8l-143.6-82.9c-1.7-1-1-3.6 1-3.6h292.5c4.2 0 6.8 4.5 4.7 8.1h0z" ' +
      'fill="#edecec"/>',
  },
  // Claude Code — official vendor favicon.
  // Source: https://claude.ai/favicon.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 2558 B; body 2450 B; own background plate: no.
  'claude': {
    viewBox: '0 0 248 248',
    title: 'Claude Code',
    body: '<path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 ' +
      '132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 ' +
      '118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 ' +
      '121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 ' +
      '76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 ' +
      '51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 ' +
      '91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 ' +
      '60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 ' +
      '24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 ' +
      '96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 ' +
      '14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 ' +
      '70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 ' +
      '36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 ' +
      '96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 ' +
      '98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 ' +
      '131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 ' +
      '141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 ' +
      '142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 ' +
      '205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 ' +
      '173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 ' +
      '203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 ' +
      '241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 ' +
      '162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 ' +
      '222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 ' +
      '160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 ' +
      '185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" fill="#D97757"/>',
  },
  // Qoder — the mark the vendor serves as its own favicon, vendored whole.
  // Source: https://qoder.com/favIcon.svg (HTTP 200 image/svg+xml, 73379 B; fetched 2026-11-25).
  // That file is the mark on a #F3F3F3 rounded plate. The plate is dropped here for the same reason
  // every other mark in this file has none: the badge paints the glyph in currentColor, and the plate
  // is the favicon background rather than part of the mark.
  // Source file 73379 B including the plate; body 2100 B; own background plate: no.
  // The outer ring is a stroke-only shape and the badge paints every glyph with fill: currentColor,
  // which would fill it and hide the ring, so the shape declares fill="none" for itself.
  // The two paths are the source bytes minified with svgo at floatPrecision 0, fills and strokes
  // rewritten to currentColor. Trade mark of Qoder; nominative use to identify the tool only,
  // licence UNVERIFIED.
  'qoder': {
    viewBox: '0 0 206 206',
    title: 'Qoder',
    body: '<path fill="currentColor" fill-rule="evenodd" d="m104 36 50 27q9 4 13 13 5 8 5 19v63q0 9-7 1' +
      '3-6 4-14 1l-9-4-1 1h-1l-1 1h-1l-1 1h-2l-2 1h-1l-2 1-3 1h-2l-1 1h-16l-1-1h-1l-2-1h-2l-1-1h-1l' +
      '-49-26-1-1-7-4-2-3-1-2q-8-9-8-23V90l1-8v-1l1-4 1-3 2-4v-1l1-4h1v-1l2-3v-1l2-2 1-1 1-1v-1l3-3' +
      'v-1l1-1 1-1 4-3 5-4h1l3-3h1l3-2h2l5-2 3-1 6-1h13l1 1h1l3 1zm1 127 1 1h2l1 1h4l1 1h3l1-1h5l1-' +
      '1 4-1h2l1-1h2l1-1h1l1-1 1-1h1l1-1h5l11 5 5-1 2-4V95q0-16-13-24l-2-1h-2l-1-1h-11l-3 1-3 1h-2l' +
      '-1 1-2 1h-1v21l-1 3v2l-1 4v2l-1 2-1 3-1 2v1l-1 1v1l-1 2v1l-1 1-1 2-1 1-1 1v1h-1l-1 2v1l-2 1-' +
      '3 3-1 2h-1l-1 2h-1l-1 1v1h-1l-3 2-2 1q0 16 12 23m-20-11-2-13v-22l1-8v-1l1-3 1-4v-1l3-7 1-2 1' +
      '-2v-1h1l1-2 3-5h1v-1l1-1 7-7 3-2 1-1 1-1h1l4-2v-1h1l2-1h1l3-2h1l2-1 3-1h1L99 45h-1l-1-1h-1l-' +
      '1-1h-5v-1h-2l-2 1h-2l-4 1-3 1-4 1h-2v1h-1l-1 1h-1l-3 2-1 1-2 1-5 5h-1v1l-1 1-2 2-1 1v1h-1v1l' +
      '-2 2v1l-1 2-1 1v1l-1 2v1l-1 1-1 4v1l-1 1v3l-1 5v24a28 28 0 0 0 6 19l2 1 5 4zm8-24v-1l2-1 4-4' +
      ' 1-2 1-1 1-1v-1l1-1v-1l1-1 1-1v-1l1-2 1-1v-1l1-1v-1l1-2v-2l1-2v-3l1-1V79l-1 1-5 6h-1l-1 1-3 ' +
      '4-1 2v1l-2 3-2 4-1 3-1 4v2l-1 4v14" clip-rule="evenodd"/><path fill="none" stroke="currentColor" stroke-' +
      'width="3.5" d="m42 61-2 4h-1l-1 5-2 4v1l-1 2v2l-1 2v1l-1 8v23a38 38 0 0 0 9 25l2 3 8 5 49 26' +
      'h1l1 1h2v1h3l1 1h16l1-1h2l3-1 3-1 2-1h2l1-1h1l1-1h1l1-1 9 4q8 3 14-1t7-13V95q0-11-5-19a32 32' +
      ' 0 0 0-13-13l-50-27h-1l-2-1-3-1h-1l-1-1H84l-6 1-3 1-5 2h-2l-3 2h-1l-4 3-5 4-5 4-1 1v1l-3 3v1' +
      'l-2 2zm0 0Zm63 11-7 7-1 1v1h-1l-4 7h-1v1l-2 4-3 7v1l-1 4-1 3v1l-1 8v22l2 13-29-15-5-4-3-3q-5' +
      '-7-5-17V90l1-7v-2l1-2 1-4 1-2v-1l1-2 1-1 1-3 1-1 1-1v-1h1v-1l1-1 2-2 1-1 1-1v-1l5-4 3-2 3-2h' +
      '1l1-1h1v-1h1l5-1 3-1 4-1h2l4-1v1h5l1 1h1l2 1 29 15h-1l-3 1-2 1h-1l-3 2h-1l-3 1v1h-1l-4 2-1 1' +
      '-1 1zm0 0Zm-4-37Zm4 128h1l1 1h2l1 1h4l1 1h3l1-1h5l1-1 4-1h2l1-1h2l1-1h1l1-1 1-1h1l1-1h5l11 5' +
      ' 5-1 2-4V95q0-16-13-24l-2-1h-2l-1-1h-11l-3 1-3 1h-2l-1 1-2 1h-1v21l-1 3v2l-1 4v2l-1 2-1 3-1 ' +
      '2v1l-1 1v1l-1 2v1l-1 1-1 2-1 1-1 1v1h-1l-1 2v1l-2 1-3 3-1 2h-1l-1 2h-1l-1 1v1h-1l-3 2-2 1q0 ' +
      '16 12 23Zm-12-35h1v-1l2-1 4-4 1-2 1-1 1-1v-1l1-1v-1l1-1 1-1v-1l1-2 1-1v-1l1-1v-1l1-2v-2l1-2v' +
      '-3l1-1V79l-1 1-5 6h-1l-1 1-3 4-1 2v1l-2 3-2 4-1 3-1 4v2l-1 4z"/>',
  },
  // TRAE — simple-icons glyph; trae.ai serves only a PNG favicon.
  // Source: https://cdn.jsdelivr.net/npm/simple-icons@16.38.1/icons/trae.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 205 B; body 109 B; own background plate: no.
  'trae': {
    viewBox: '0 0 24 24',
    title: 'TRAE',
    body: '<path d="M24 20.5H3.5V17H0V3.5h24ZM3.5 17h17V7h-17Zm8.5-5-2.5 2.5L7 12l2.5-2.5Zm7 0-2.5 2.5L14 ' +
      '12l2.5-2.5z"/>',
  },
  // TRAE CN — the same glyph as TRAE, because it is the same mark: the CN site's
  // favicon.png (https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae_website_prod_cn/favicon.png,
  // 488 B, 48x48) is byte-identical to the one the international site links, and neither
  // site publishes an SVG. The CN rules directory is its own source key, so the chip needs
  // its own entry rather than a fall-through.
  // Source: https://cdn.jsdelivr.net/npm/simple-icons@16.38.1/icons/trae.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 205 B; body 109 B; own background plate: no.
  'trae-cn': {
    viewBox: '0 0 24 24',
    title: 'Trae CN',
    body: '<path d="M24 20.5H3.5V17H0V3.5h24ZM3.5 17h17V7h-17Zm8.5-5-2.5 2.5L7 12l2.5-2.5Zm7 0-2.5 2.5L14 ' +
      '12l2.5-2.5z"/>',
  },
  // Cline — simple-icons 16.38.1 glyph (CC0 packaging). The vendor app icon
  // (https://raw.githubusercontent.com/cline/cline/main/apps/vscode/assets/icons/icon.svg, 3574 B,
  // viewBox "0 0 113 113") and the JetBrains plugin icon (3687 B, plate #333C44) are both larger.
  // Source: https://cdn.jsdelivr.net/npm/simple-icons@16.38.1/icons/cline.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 776 B; body 664 B; own background plate: no.
  // Root width/height dropped: none present. Declared colours: fill=#18181B.
  'cline': {
    viewBox: '0 0 24 24',
    title: 'Cline',
    body: '<path d="m23.365 13.556-1.442-2.895V8.994c0-2.764-2.218-5.002-4.954-5.002h-2.464c.178-.367.276-.779.276-' +
      '1.213A2.77 2.77 0 0 0 12.018 0a2.77 2.77 0 0 0-2.763 2.779c0 .434.098.846.276 1.213H7.067c-2.736 0-4.954' +
      ' 2.238-4.954 5.002v1.667L.64 13.549c-.149.29-.149.636 0 .927l1.472 2.855v1.667C2.113 21.762 4.33 24 7.06' +
      '7 24h9.902c2.736 0 4.954-2.238 4.954-5.002V17.33l1.44-2.865c.143-.286.143-.622.002-.91m-12.854 2.36a2.27' +
      ' 2.27 0 0 1-2.261 2.273 2.27 2.27 0 0 1-2.261-2.273v-4.042A2.27 2.27 0 0 1 8.249 9.6a2.267 2.267 0 0 1 2' +
      '.262 2.274zm7.285 0a2.27 2.27 0 0 1-2.26 2.273 2.27 2.27 0 0 1-2.262-2.273v-4.042A2.267 2.267 0 0 1 15.5' +
      '35 9.6a2.267 2.267 0 0 1 2.261 2.274z"/>',
  },
  // Windsurf — simple-icons 16.38.1 glyph (CC0 packaging). The vendor favicon
  // (https://windsurf.com/favicon.svg, 1344 B, identical to codeium.com/favicon.svg) is the same
  // waveform on a cream #F9F3E9 plate behind a clipPath.
  // Source: https://cdn.jsdelivr.net/npm/simple-icons@16.38.1/icons/windsurf.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 828 B; body 713 B; own background plate: no.
  // Root width/height dropped: none present. Declared colours: fill=#0B100F.
  'windsurf': {
    viewBox: '0 0 24 24',
    title: 'Windsurf',
    body: '<path d="M23.55 5.067c-1.2038-.002-2.1806.973-2.1806 2.1765v4.8676c0 .972-.8035 1.7594-1.7597 1.7594-.56' +
      '8 0-1.1352-.286-1.4718-.7659l-4.9713-7.1003c-.4125-.5896-1.0837-.941-1.8103-.941-1.1334 0-2.1533.9635-2.' +
      '1533 2.153v4.8957c0 .972-.7969 1.7594-1.7596 1.7594-.57 0-1.1363-.286-1.4728-.7658L.4076 5.1598C.2822 4.' +
      '9798 0 5.0688 0 5.2882v4.2452c0 .2147.0656.4228.1884.599l5.4748 7.8183c.3234.462.8006.8052 1.3509.9298 1' +
      '.3771.313 2.6446-.747 2.6446-2.0977v-4.893c0-.972.7875-1.7593 1.7596-1.7593h.003a1.798 1.798 0 0 1 1.471' +
      '8.7658l4.9723 7.0994c.4135.5905 1.05.941 1.8093.941 1.1587 0 2.1515-.9645 2.1515-2.153v-4.8948c0-.972.78' +
      '75-1.7594 1.7596-1.7594h.194a.22.22 0 0 0 .2204-.2202v-4.622a.22.22 0 0 0-.2203-.2203Z"/>',
  },
  // GitHub Copilot — simple-icons 16.38.1 glyph (CC0 packaging). GitHub's own JetBrains plugin
  // icon (https://plugins.jetbrains.com/files/17718/1227055/icon/default.svg, 2768 B) is the same
  // mark on a white disc and is the alternative if a plate is ever wanted.
  // Source: https://cdn.jsdelivr.net/npm/simple-icons@16.38.1/icons/githubcopilot.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 1759 B; body 1638 B; own background plate: no.
  // Root width/height dropped: none present. Declared colours: fill=#000000.
  'copilot': {
    viewBox: '0 0 24 24',
    title: 'GitHub Copilot',
    body: '<path d="M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0' +
      ' 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.' +
      '517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937' +
      ' 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.1' +
      '32 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.84' +
      '1 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.' +
      '918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.77' +
      '9 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259' +
      '-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0' +
      ' .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 ' +
      '0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938' +
      ' 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-' +
      '.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893' +
      'Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.5' +
      '29-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.' +
      '084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z"/>',
  },
  // Junie — JetBrains' own JetBrains Marketplace plugin icon (plugin 26104, xmlId
  // org.jetbrains.junie, vendor "JetBrains s.r.o.", isVerified true). This file needs a
  // plugins.jetbrains.com referer; without one it answers 403.
  // Source: https://plugins.jetbrains.com/files/26104/1223531/icon/default.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 340 B; body 234 B; own background plate: no.
  // Root width/height dropped: yes. Declared colours: fill=none fill=#48E054.
  'junie': {
    viewBox: '0 0 40 40',
    title: 'Junie',
    body: '<path d="M25 15H35V16.75C35 29 30.5001 35 16.5001 35H15V25H16.5001C22.6251 25 25 22.875 25 16.75V15Z" fi' +
      'll="#48E054"/><rect x="5" y="15" width="10" height="10" fill="#48E054"/><rect x="15" y="5" width="10" he' +
      'ight="10" fill="#48E054"/>',
  },
  // Amazon Q — Amazon Web Services' own JetBrains Marketplace plugin icon (plugin 24267, xmlId
  // amazon.q, vendor "Amazon Web Services", isVerified true). aws.amazon.com serves no standalone
  // SVG (favicon 403; the marketing page carries only an inline wordmark lockup in currentColor).
  // Source: https://plugins.jetbrains.com/files/24267/1224558/icon/default.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 2517 B; body 2375 B; own background plate: no.
  // Root width/height dropped: yes. Declared colours: fill=none fill=url(#paint0_linear_2420_34) fill=white stop-color=#A7F8FF stop-color=#9DF1FF stop-color=#84E1FF stop-color=#5AC7FF stop-color=#21A2FF stop-color=#008DFF stop-color=#7F33FF stop-color=#39127D.
  // Renamed ids: clip0_2420_34 -> amazonqClip0, paint0_linear_2420_34 -> amazonqFill0.
  'amazonq': {
    viewBox: '0 0 40 40',
    title: 'Amazon Q',
    body: '<g clip-path="url(#amazonqClip0)"><path d="M17.2353 2.73969L6.43534 8.975C4.72534 9.96219 3.67065 11.787' +
      '5 3.67065 13.7647V26.2353C3.67065 28.2125 4.72534 30.0378 6.43534 31.025L17.2353 37.2603C18.9453 38.2475' +
      ' 21.0547 38.2475 22.7647 37.2603L33.5647 31.025C35.2747 30.0378 36.3294 28.2125 36.3294 26.2353V13.7647C' +
      '36.3294 11.7903 35.2747 9.96219 33.5647 8.975L22.7647 2.73969C21.0547 1.7525 18.9453 1.7525 17.2353 2.73' +
      '969Z" fill="url(#amazonqFill0)"/><path d="M30.4006 11.8859L21.8253 6.93594C21.3219 6.64625 20.6609 6.5 1' +
      '9.9972 6.5C19.3334 6.5 18.6725 6.64625 18.1691 6.93594L9.59375 11.8859C8.58969 12.4653 7.76562 13.8913 7' +
      '.76562 15.05V24.95C7.76562 26.1116 8.58688 27.5347 9.59375 28.1141L18.1691 33.0641C18.6725 33.3537 19.33' +
      '34 33.5 19.9972 33.5C20.6609 33.5 21.3219 33.3537 21.8253 33.0641L30.4006 28.1141C31.4047 27.5347 32.228' +
      '8 26.1087 32.2288 24.95V15.05C32.2288 13.8884 31.4075 12.4653 30.4006 11.8859ZM20.7003 31.1178C20.6216 3' +
      '1.1628 20.3713 31.2528 19.9972 31.2528C19.6231 31.2528 19.3756 31.1656 19.2941 31.1178L10.7188 26.1678C1' +
      '0.4094 25.9906 10.0156 25.3072 10.0156 24.9528V15.0528C10.0156 14.6956 10.4094 14.015 10.7188 13.8378L19' +
      '.2941 8.88781C19.3728 8.84281 19.6231 8.75281 19.9972 8.75281C20.3713 8.75281 20.6187 8.84 20.7003 8.887' +
      '81L29.2756 13.8378C29.585 14.015 29.9788 14.6984 29.9788 15.0528V24.4662L22.25 20.0056V19.0803C22.25 18.' +
      '8497 22.1262 18.6359 21.9266 18.5178L20.3234 17.5925C20.2222 17.5334 20.1125 17.5053 20 17.5053C19.8875 ' +
      '17.5053 19.775 17.5334 19.6766 17.5925L18.0734 18.5178C17.8738 18.6331 17.75 18.8469 17.75 19.0803V20.93' +
      '09C17.75 21.1616 17.8738 21.3753 18.0734 21.4934L19.6766 22.4187C19.7778 22.4778 19.8875 22.5059 20 22.5' +
      '059C20.1125 22.5059 20.225 22.4778 20.3234 22.4187L21.125 21.9575L28.8538 26.4181L20.7031 31.1234L20.700' +
      '3 31.1178Z" fill="white"/></g><defs><linearGradient id="amazonqFill0" x1="34.49" y1="-0.691563" x2="7.30' +
      '44" y2="38.1294" gradientUnits="userSpaceOnUse"><stop stop-color="#A7F8FF"/><stop offset="0.03" stop-col' +
      'or="#9DF1FF"/><stop offset="0.08" stop-color="#84E1FF"/><stop offset="0.15" stop-color="#5AC7FF"/><stop ' +
      'offset="0.22" stop-color="#21A2FF"/><stop offset="0.26" stop-color="#008DFF"/><stop offset="0.66" stop-c' +
      'olor="#7F33FF"/><stop offset="0.99" stop-color="#39127D"/></linearGradient><clipPath id="amazonqClip0"><' +
      'rect width="36" height="36" fill="white" transform="translate(2 2)"/></clipPath></defs>',
  },
  // Tabnine — Tabnine's own JetBrains Marketplace plugin icon (plugin 12798, xmlId
  // com.tabnine.TabNine, vendor "Tabnine"; the enterprise plugin 21531 carries the same file).
  // This is the outline form of the hexagon in the VS Code extension logo; the wordmark lockups
  // (logo.svg 3634 B, tabnine-logo-dark.svg 3337 B) are far larger.
  // Source: https://plugins.jetbrains.com/files/12798/964375/icon/default.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 371 B; body 267 B; own background plate: no.
  // Root width/height dropped: yes. Declared colours: fill=none stroke=#FF4E40.
  // The source root carried fill="none" and this is a stroke-only outline, so
  // that attribute is kept on the shape: without it the path fills black and the
  // hexagon reads as a solid block instead of an outline.
  'tabnine': {
    viewBox: '0 0 30 34',
    title: 'Tabnine',
    body: '<path fill="none" d="M29.1527 17L8.03818 29M29.1527 17L7.96201 5.04375M29.1527 17V9L15.0764 1L7.96201 5.04375M29.152' +
      '7 17L29.1527 25L15.0764 33L8.03818 29M8.03818 29L7.96201 5.04375M8.03818 29L1 25L1 9L7.96201 5.04375" st' +
      'roke="#FF4E40" stroke-width="1.4" stroke-linejoin="round"/>',
  },
  // Continue — the vendor's own IntelliJ plugin icon (continuedev/continue). Its neutral
  // #6C707E reads on either theme, unlike docs/logo/dark.svg (fill white) and docs/logo/light.svg
  // (fill black), which are the same glyph at 1588 B each.
  // Source: https://raw.githubusercontent.com/continuedev/continue/main/extensions/intellij/src/main/resources/icons/continue.svg (HTTP 200 image/svg+xml; fetched 2026-11-23).
  // Source file 1597 B; body 1480 B; own background plate: no.
  // Root width/height dropped: yes. Declared colours: fill=none fill=#6C707E.
  'continue': {
    viewBox: '0 0 13 13',
    title: 'Continue',
    body: '<path d="M10.4742 1.6668L9.77141 2.88516L11.5477 5.95951C11.5607 5.98283 11.5685 6.01135 11.5685 6.03728' +
      'C11.5685 6.0632 11.5607 6.09172 11.5477 6.11505L9.77141 9.19199L10.4742 10.4104L13 6.03728L10.4742 1.664' +
      '21V1.6668ZM9.4991 2.72702L10.2019 1.50867H8.79634L8.09357 2.72702H9.5017H9.4991ZM8.09097 3.0433L9.73249 ' +
      '5.88173H11.138L9.4991 3.0433H8.09097ZM9.4991 9.03645L11.138 6.19542H9.73249L8.09097 9.03645H9.4991ZM8.09' +
      '097 9.35273L8.79374 10.5659H10.1993L9.4965 9.35273H8.08837H8.09097ZM3.32716 10.8666C3.29864 10.8666 3.27' +
      '271 10.8588 3.24939 10.8458C3.22599 10.8329 3.20527 10.8122 3.19227 10.7889L1.41332 7.71183H0.00777705L2' +
      '.53362 12.0824H7.58267L6.87991 10.8666H3.32976H3.32716ZM7.15222 10.7085L7.85498 11.9242L8.55775 10.7059L' +
      '7.85498 9.48755L7.15222 10.7059V10.7085ZM7.58267 9.33201H4.30484L3.60207 10.5503H6.87991L7.58267 9.33201' +
      'ZM4.02992 9.17647L2.38841 6.33536L1.68562 7.55376L3.32716 10.3948L4.02992 9.17647ZM0.00518489 7.39562H1.' +
      '41073L2.1135 6.17729H0.71055L0.00518489 7.39562ZM3.18454 1.29611C3.19746 1.27278 3.21826 1.25205 3.24159' +
      ' 1.23908C3.26491 1.22612 3.29344 1.21834 3.31936 1.21834H6.87471L7.57747 0H2.52582L0 4.37305H1.40555L3.1' +
      '7934 1.29871L3.18454 1.29611ZM2.1135 5.90506L1.41073 4.68673H0.00518489L0.707957 5.90506H2.1135ZM3.32196' +
      ' 1.69013L1.68303 4.52859L2.38581 5.74699L4.02472 2.90848L3.32196 1.69013ZM6.87731 1.532H3.59427L4.29704 ' +
      '2.75034H7.58007L6.87731 1.532ZM7.85498 2.5922L8.55515 1.37647L7.85498 0.158126L7.15222 1.37388L7.85498 2' +
      '.5922Z" fill="#6C707E"/>',
  },
  // Lingma (通义灵码) — Alibaba's own mark, taken from the favicon the product's help site
  // declares for itself. The source names no licence; this is nominative use to identify the
  // tool only, UNVERIFIED.
  // Source: https://img.alicdn.com/imgextra/i2/O1CN01TFs5Qw27uYvfA6gib_!!6000000007857-55-tps-32-32.svg (HTTP 200 image/svg+xml; fetched 2026-11-25),
  //   declared by https://help.aliyun.com/zh/lingma/qoder-cn/user-guide/rules as its <link rel="icon">.
  // Source file 908 B; body 736 B; own background plate: no.
  // Root width/height dropped: yes (32/32). Declared colours: fill=none fill=#1366EC fill=#FF6A00 fill-opacity=1.
  // Renamed ids: master_svg0_8_3602 -> lingmaClip0.
  'lingma': {
    viewBox: '0 0 32 32',
    title: 'Lingma',
    body: '<defs><clipPath id="lingmaClip0"><rect x="0" y="0" width="32" height="32" rx="0"/></clipPath></defs><g cli' +
      'p-path="url(#lingmaClip0)"><g><g><g><path d="M13.62132,26.8786Q14.5,27.7574,14.5,29L14.5,30L17.5,30L17.5,1' +
      '0Q17.5,7.5147200000000005,15.7426,5.75736Q13.98528,4,11.5,4L4,4L4,26L11.5,26Q12.74264,26,13.62132,26.8786Z' +
      '" fill-rule="evenodd" fill="#1366EC" fill-opacity="1" style="mix-blend-mode:passthrough"/></g></g><g><g><p' +
      'ath d="M17.5,9.99788Q17.49931,7.70312,16,6.02912Q16.123589,5.89113,16.257359,5.75736Q18.01472,4,20.5,4L28,' +
      '4L28,26L20.5,26L20.5,23L25,23L25,7L20.5,7Q19.25736,7,18.37868,7.87868Q17.50075,8.75662,17.5,9.99788Z" fill' +
      '-rule="evenodd" fill="#FF6A00" fill-opacity="1" style="mix-blend-mode:passthrough"/></g></g></g></g>',
  },
  // JetBrains AI Assistant — JetBrains' own JetBrains Marketplace plugin icon (plugin 22282,
  // xmlId com.intellij.ml.llm, vendor "JetBrains", isVerified true; re-measured this session via
  // https://plugins.jetbrains.com/api/plugins/22282 -> HTTP 200). The plugins.jetbrains.com file
  // URL redirects to the downloads host, so both are recorded. JetBrains' Brand Guidelines allow
  // a "built-in integration" to show the mark, which is what this panel is; that page could not
  // be re-fetched for this entry (www.jetbrains.com/company/brand/ served navigation JSON only,
  // /legal/docs/company/brand_guidelines/ answered 404), so the licence line is UNVERIFIED here.
  // Source: https://plugins.jetbrains.com/files/22282/1227866/icon/default.svg
  //   (HTTP 301 -> https://downloads.marketplace.jetbrains.com/files/22282/1227866/icon/default.svg, HTTP 200 image/svg+xml; fetched 2026-11-25).
  // Source file 910 B; body 816 B; own background plate: no.
  // Root width/height dropped: yes (40/40). Declared colours: fill=url(#aiassistantFill0) stop-color=#955AE0 stop-color=#4D67F0.
  // Renamed ids: a -> aiassistantFill0.
  'aiassistant': {
    viewBox: '0 0 40 40',
    title: 'JetBrains AI Assistant',
    body: '<path fill="url(#aiassistantFill0)" d="M6.48 9.44C9.36 7.8 13.32 7 16.72 7 26.68 7 33 11.64 33 17.92c0 5-4' +
      '.36 8.08-10.16 8.08-4.68 0-8.16-1.72-8.16-4 0-2.16 2.2-3.2 5.32-2l.8-2.44c-4.84-1.56-8.84.64-8.84 4.44 0 3' +
      '.8 4.72 6.52 11.04 6.52 7.52 0 13-4.16 13-10.6C36 9.88 28.4 4 16.72 4c-3.76 0-8 .96-11.48 2.84l1.24 2.6Zm2' +
      '7.04 21.12C30.64 32.2 26.68 33 23.28 33 13.32 33 7 28.36 7 22.08c0-5 4.36-8.08 10.16-8.08 4.68 0 8.16 1.72' +
      ' 8.16 4 0 2.16-2.2 3.2-5.32 2l-.8 2.44c4.84 1.56 8.84-.64 8.84-4.44 0-3.8-4.72-6.52-11.04-6.52-7.52 0-13 4' +
      '.16-13 10.6C4 30.12 11.6 36 23.28 36c3.76 0 8-.96 11.48-2.84l-1.24-2.6Z"/><defs><linearGradient id="aiassi' +
      'stantFill0" x1="7.164" x2="51.071" y1="9.757" y2="43.832" gradientUnits="userSpaceOnUse"><stop stop-color=' +
      '"#955AE0"/><stop offset="1" stop-color="#4D67F0"/></linearGradient></defs>',
  },
  // Google Antigravity — the press-kit mark served from antigravity.google's own brand folder.
  // The one-color variant (435 B, same viewBox) is NOT used: its single path hard-codes
  // fill="#202124" instead of currentColor, so on the panel's dark theme it renders as a
  // near-invisible dark blob (measured: a tint page setting color:#ff0000 over #1e1e1e left the
  // mark unchanged). This full-colour file carries its own colours on the child elements and is
  // legible on both themes. Google ships these assets through the press kit only, with no
  // Antigravity-specific grant, so the licence is UNVERIFIED and use is nominative.
  // Source: https://antigravity.google/assets/image/brand/antigravity-icon__full-color.svg (HTTP 200 image/svg+xml; fetched 2026-11-25).
  // Source file 5301 B; body 4405 B; own background plate: no.
  // Root width/height dropped: yes (180/180). Declared colours: fill=none fill=#3186FF fill=white fill=#FFE432 fill=#FC413D fill=#00B95C fill=#FBBC04 fill=#749BFF fill=#FFEE48.
  // Renamed ids: mask0_6001_409 -> antigravityMask0, filter0_f_6001_409 .. filter10_f_6001_409 -> antigravityBlur0 .. antigravityBlur10.
  // Coordinate digits trimmed: coordinates, ellipse/transform numbers and filter windows to 1 decimal,
  // and the feGaussianBlur stdDeviation radii (6.25234 .. 30.2268) to 1 decimal as well — the 5301 B
  // source was over the ~2.5 KB budget and the blur floor of 1 is respected.
  'antigravity': {
    viewBox: '0 0 180 180',
    title: 'Google Antigravity',
    body: '<path d="M144.2 149.1C151.7 154.7 163 150.9 152.7 140.6C121.7 110.6 128.3 28.1 89.9 28.1C51.4 28.1 58 110.' +
      '6 27.1 140.6C15.8 151.9 28 154.7 35.5 149.1C64.6 129.4 62.7 94.7 89.9 94.7C117.1 94.7 115.2 129.4 144.2 14' +
      '9.1Z" fill="#3186FF"/><mask id="antigravityMask0" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="22' +
      '" y="28" width="136" height="125"><path d="M144.2 149.1C151.7 154.7 163 150.9 152.7 140.6C121.7 110.6 128.' +
      '3 28.1 89.9 28.1C51.4 28.1 58 110.6 27.1 140.6C15.8 151.9 28 154.7 35.5 149.1C64.6 129.4 62.7 94.7 89.9 94' +
      '.7C117.1 94.7 115.2 129.4 144.2 149.1Z" fill="white"/></mask><g mask="url(#antigravityMask0)"><g filter="u' +
      'rl(#antigravityBlur0)"><ellipse cx="36.6" cy="43.1" rx="36.6" ry="43.1" transform="matrix(-0.1 1 -1 -0.1 1' +
      '06.6 -26.5)" fill="#FFE432"/></g><g filter="url(#antigravityBlur1)"><ellipse cx="155.2" cy="54.9" rx="47.4' +
      '" ry="48.5" transform="rotate(76.9 155.2 54.9)" fill="#FC413D"/></g><g filter="url(#antigravityBlur2)"><el' +
      'lipse cx="14.6" cy="65.4" rx="49.6" ry="64.2" transform="rotate(74.1 14.6 65.4)" fill="#00B95C"/></g><g fi' +
      'lter="url(#antigravityBlur3)"><ellipse cx="14.6" cy="65.4" rx="49.6" ry="64.2" transform="rotate(74.1 14.6' +
      ' 65.4)" fill="#00B95C"/></g><g filter="url(#antigravityBlur4)"><ellipse cx="18.1" cy="67.4" rx="48.6" ry="' +
      '53.5" transform="rotate(45.6 18.1 67.4)" fill="#00B95C"/></g><g filter="url(#antigravityBlur5)"><ellipse c' +
      'x="121.8" cy="166.9" rx="46.6" ry="44.9" transform="rotate(76.9 121.8 166.9)" fill="#3186FF"/></g><g filte' +
      'r="url(#antigravityBlur6)"><ellipse cx="53.9" cy="56.9" rx="53.9" ry="56.9" transform="matrix(-0.4 0.9 -0.' +
      '9 -0.4 162.8 -25.9)" fill="#FBBC04"/></g><g filter="url(#antigravityBlur7)"><path d="M4.2 239.1C-25.3 227.' +
      '5 25.2 132.1 37.7 100.1C50.3 68.1 84.4 51.6 113.9 63.2C143.5 74.8 178.5 138.7 165.9 170.6C153.4 202.6 33.8' +
      ' 250.7 4.2 239.1Z" fill="#3186FF"/></g><g filter="url(#antigravityBlur8)"><path d="M183.2 120.3C175.3 129.' +
      '5 154.7 124.8 137.1 109.8C119.6 94.8 111.7 75.1 119.6 65.9C127.6 56.6 148.2 61.3 165.7 76.4C183.3 91.4 191' +
      '.1 111.1 183.2 120.3Z" fill="#749BFF"/></g><g filter="url(#antigravityBlur9)"><ellipse cx="148.9" cy="36.7' +
      '" rx="71.1" ry="44.2" transform="rotate(34.1 148.9 36.7)" fill="#FC413D"/></g><g filter="url(#antigravityB' +
      'lur10)"><ellipse cx="37.8" cy="46" rx="38.1" ry="22.2" transform="rotate(112.5 37.8 46)" fill="#FFEE48"/><' +
      '/g></g><defs><filter id="antigravityBlur0" x="4.1" y="-44.2" width="111" height="98.4" filterUnits="userSp' +
      'aceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="6.3"/></filter><filter id="anti' +
      'gravityBlur1" x="46.3" y="-53" width="217.7" height="215.9" filterUnits="userSpaceOnUse" color-interpolati' +
      'on-filters="sRGB"><feGaussianBlur stdDeviation="30.2"/></filter><filter id="antigravityBlur2" x="-100" y="' +
      '-36.8" width="229.2" height="204.4" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGau' +
      'ssianBlur stdDeviation="25.7"/></filter><filter id="antigravityBlur3" x="-100" y="-36.8" width="229.2" hei' +
      'ght="204.4" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="' +
      '25.7"/></filter><filter id="antigravityBlur4" x="-84.4" y="-35" width="205" height="204.8" filterUnits="us' +
      'erSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="25.7"/></filter><filter id=' +
      '"antigravityBlur5" x="28" y="71.5" width="187.7" height="190.8" filterUnits="userSpaceOnUse" color-interpo' +
      'lation-filters="sRGB"><feGaussianBlur stdDeviation="24.4"/></filter><filter id="antigravityBlur6" x="-11.9' +
      '" y="-98.7" width="201.4" height="197.4" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><' +
      'feGaussianBlur stdDeviation="22.1"/></filter><filter id="antigravityBlur7" x="-44.4" y="20" width="252.5" ' +
      'height="260.4" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviatio' +
      'n="19.8"/></filter><filter id="antigravityBlur8" x="81.2" y="25.8" width="140.5" height="134.6" filterUnit' +
      's="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="17.7"/></filter><filte' +
      'r id="antigravityBlur9" x="55.1" y="-47.3" width="187.6" height="168" filterUnits="userSpaceOnUse" color-i' +
      'nterpolation-filters="sRGB"><feGaussianBlur stdDeviation="14.9"/></filter><filter id="antigravityBlur10" x' +
      '="-24.3" y="-27.2" width="124.2" height="146.4" filterUnits="userSpaceOnUse" color-interpolation-filters="' +
      'sRGB"><feGaussianBlur stdDeviation="18.5"/></filter></defs>',
  },
  // Kiro — AWS's own mark, from the icon kiro.dev declares for itself. AWS's Trademark Guidelines
  // permit using the mark to identify the service and require written permission for anything
  // beyond that; this entry is identification only. The source page names no licence: UNVERIFIED.
  // Source: https://kiro.dev/icon.svg (HTTP 200 image/svg+xml; fetched 2026-11-25), declared by
  //   https://kiro.dev as <link rel="icon" type="image/svg+xml">.
  // Source file 1527 B; body 1395 B; own background plate: yes (#9046FF, 1200x1200 rect rx=260).
  // Root width/height dropped: yes (1200/1200). Declared colours: fill=none fill=#9046FF fill=white fill=black.
  // Renamed ids: mask0_1106_4856 -> kiroMask0.
  'kiro': {
    viewBox: '0 0 1200 1200',
    title: 'Kiro',
    body: '<rect width="1200" height="1200" rx="260" fill="#9046FF"/><mask id="kiroMask0" style="mask-type:luminance"' +
      ' maskUnits="userSpaceOnUse" x="272" y="202" width="655" height="796"><path d="M926.578 202.793H272.637V997' +
      '.857H926.578V202.793Z" fill="white"/></mask><g mask="url(#kiroMask0)"><path d="M398.554 818.914C316.315 10' +
      '01.03 491.477 1046.74 620.672 940.156C658.687 1059.66 801.052 970.473 852.234 877.795C964.787 673.567 919.' +
      '318 465.357 907.64 422.374C827.637 129.443 427.623 128.946 358.8 423.865C342.651 475.544 342.402 534.18 33' +
      '3.458 595.051C328.986 625.86 325.507 645.488 313.83 677.785C306.873 696.424 297.68 712.819 282.773 740.645' +
      'C259.915 783.881 269.604 867.113 387.87 823.883L399.051 818.914H398.554Z" fill="white"/><path d="M636.123 ' +
      '549.353C603.328 549.353 598.359 510.097 598.359 486.742C598.359 465.623 602.086 448.977 609.293 438.293C61' +
      '5.504 428.852 624.697 424.131 636.123 424.131C647.555 424.131 657.492 428.852 664.447 438.541C672.398 449.' +
      '474 676.623 466.12 676.623 486.742C676.623 525.998 661.471 549.353 636.375 549.353H636.123Z" fill="black"/' +
      '><path d="M771.24 549.353C738.445 549.353 733.477 510.097 733.477 486.742C733.477 465.623 737.203 448.977 ' +
      '744.41 438.293C750.621 428.852 759.814 424.131 771.24 424.131C782.672 424.131 792.609 428.852 799.564 438.' +
      '541C807.516 449.474 811.74 466.12 811.74 486.742C811.74 525.998 796.588 549.353 771.492 549.353H771.24Z" f' +
      'ill="black"/></g>',
  },
  // Augment Code — the black lockup from Augment's official press-kit archive
  // (augment-cosmos-logos.zip, 99419 B byte size), entry augment/black.svg. The archive's
  // white-nobg.svg is a white stroke-only mark and would be invisible on the panel's light theme,
  // so black.svg is the one vendored. Augment publishes the kit without a brand-terms page, so
  // the licence stays UNVERIFIED; the mark identifies the tool and nothing more.
  // Source: https://www.augmentcode.com/downloads/augment-cosmos-logos.zip -> augment/black.svg (HTTP 200 application/zip, entry 4906 B; fetched 2026-11-25).
  // Source file 4906 B; body 3497 B; own background plate: yes (#233A3E, 25x25 rect).
  // Root width/height dropped: yes (25/25). Declared colours: fill=none fill=#233A3E fill=#F8F7F7 stroke=#F8F7F7.
  // Coordinate digits trimmed: the shape paths' coordinates AND the 0.259057 stroke-width to 2 decimals,
  // the floor the file header sets for opacity/stop values — the 4906 B source was over the ~2.5 KB
  // budget, and rounding further to 1 decimal would move the small radii of the glyph.
  'augment': {
    viewBox: '0 0 25 25',
    title: 'Augment Code',
    body: '<rect width="25" height="25" fill="#233A3E"/><path d="M5.51 21.16C5.17 21.16 4.89 21.11 4.66 20.99C4.44 20' +
      '.88 4.26 20.71 4.15 20.48C4.03 20.25 3.97 19.97 3.97 19.64V16.25C3.97 15.83 3.89 15.52 3.72 15.33C3.56 15.' +
      '14 3.26 15.04 2.83 15.04C2.7 15.04 2.6 14.99 2.52 14.89C2.43 14.79 2.39 14.67 2.39 14.54C2.39 14.4 2.43 14' +
      '.29 2.52 14.2C2.6 14.11 2.7 14.06 2.83 14.05C3.26 14.04 3.56 13.94 3.72 13.75C3.89 13.56 3.97 13.26 3.97 1' +
      '2.85V9.46C3.97 8.96 4.1 8.58 4.37 8.33C4.63 8.07 5.01 7.94 5.51 7.94H9.56C9.71 7.94 9.84 7.98 9.94 8.07C10' +
      '.04 8.16 10.09 8.28 10.09 8.41C10.09 8.54 10.05 8.66 9.96 8.75C9.88 8.85 9.76 8.89 9.62 8.89H5.86C5.64 8.8' +
      '9 5.48 8.95 5.37 9.06C5.26 9.17 5.2 9.34 5.2 9.57V12.98C5.2 13.27 5.14 13.55 5.02 13.79C4.9 14.03 4.74 14.' +
      '23 4.54 14.37C4.33 14.51 4.1 14.57 3.82 14.57V14.51C4.1 14.51 4.33 14.58 4.54 14.72C4.74 14.86 4.9 15.06 5' +
      '.02 15.3C5.14 15.54 5.2 15.82 5.2 16.11V19.54C5.2 19.77 5.26 19.94 5.37 20.05C5.48 20.16 5.65 20.21 5.86 2' +
      '0.21H9.62C9.76 20.21 9.88 20.26 9.96 20.35C10.05 20.45 10.09 20.56 10.09 20.69C10.09 20.82 10.04 20.93 9.9' +
      '4 21.03C9.84 21.12 9.71 21.17 9.56 21.17H5.51V21.16V21.16Z" fill="#F8F7F7" stroke="#F8F7F7" stroke-width="' +
      '0.26" stroke-miterlimit="10"/><path d="M15.44 21.16C15.29 21.16 15.16 21.12 15.06 21.02C14.96 20.93 14.91 ' +
      '20.81 14.91 20.69C14.91 20.56 14.95 20.44 15.04 20.35C15.12 20.25 15.24 20.21 15.38 20.21H19.14C19.36 20.2' +
      '1 19.52 20.15 19.63 20.04C19.74 19.93 19.8 19.76 19.8 19.53V16.11C19.8 15.81 19.86 15.54 19.98 15.3C20.1 1' +
      '5.05 20.26 14.86 20.47 14.72C20.67 14.58 20.91 14.51 21.18 14.51V14.57C20.91 14.57 20.67 14.5 20.47 14.36C' +
      '20.26 14.22 20.1 14.03 19.98 13.79C19.86 13.54 19.8 13.27 19.8 12.97V9.56C19.8 9.33 19.74 9.17 19.63 9.05C' +
      '19.52 8.95 19.36 8.89 19.14 8.89H15.38C15.24 8.89 15.13 8.84 15.04 8.75C14.95 8.65 14.91 8.54 14.91 8.41C1' +
      '4.91 8.27 14.96 8.16 15.06 8.07C15.16 7.98 15.29 7.93 15.44 7.93H19.49C19.99 7.93 20.37 8.06 20.63 8.32C20' +
      '.9 8.58 21.03 8.96 21.03 9.46V12.85C21.03 13.26 21.11 13.56 21.28 13.75C21.45 13.94 21.74 14.04 22.17 14.0' +
      '5C22.3 14.06 22.41 14.1 22.49 14.19C22.57 14.28 22.61 14.4 22.61 14.54C22.61 14.67 22.57 14.78 22.49 14.88' +
      'C22.41 14.98 22.3 15.03 22.17 15.03C21.74 15.04 21.45 15.14 21.28 15.33C21.11 15.52 21.03 15.82 21.03 16.2' +
      '4V19.63C21.03 19.96 20.97 20.24 20.85 20.47C20.74 20.7 20.57 20.87 20.34 20.99C20.11 21.1 19.83 21.16 19.4' +
      '9 21.16H15.44V21.16V21.16Z" fill="#F8F7F7" stroke="#F8F7F7" stroke-width="0.26" stroke-miterlimit="10"/><p' +
      'ath d="M16.48 15.84C17.22 15.84 17.82 15.25 17.82 14.53C17.82 13.8 17.22 13.21 16.48 13.21C15.75 13.21 15.' +
      '15 13.8 15.15 14.53C15.15 15.25 15.75 15.84 16.48 15.84Z" fill="#F8F7F7" stroke="#F8F7F7" stroke-width="0.' +
      '26" stroke-miterlimit="10"/><path d="M9 15.84C9.74 15.84 10.34 15.25 10.34 14.53C10.34 13.8 9.74 13.21 9 1' +
      '3.21C8.26 13.21 7.66 13.8 7.66 14.53C7.66 15.25 8.26 15.84 9 15.84Z" fill="#F8F7F7" stroke="#F8F7F7" strok' +
      'e-width="0.26" stroke-miterlimit="10"/><path d="M12.04 4.13L11.94 6.82C11.94 6.97 11.8 7.05 11.51 7.05C11.' +
      '22 7.05 11.07 6.97 11.07 6.82C11.05 6.15 11.03 5.63 11.01 5.26C11 4.89 10.99 4.62 10.99 4.46C10.98 4.3 10.' +
      '97 4.2 10.97 4.17V4.12C10.97 3.93 11.15 3.83 11.51 3.83C11.87 3.83 12.04 3.93 12.04 4.13ZM14.21 4.13L14.11' +
      ' 6.82C14.11 6.97 13.97 7.05 13.68 7.05C13.39 7.05 13.24 6.97 13.24 6.82C13.22 6.15 13.2 5.63 13.18 5.26C13' +
      '.17 4.89 13.16 4.62 13.15 4.46C13.15 4.3 13.14 4.2 13.14 4.17V4.12C13.14 3.93 13.32 3.83 13.68 3.83C14.03 ' +
      '3.83 14.21 3.93 14.21 4.13Z" fill="#F8F7F7" stroke="#F8F7F7" stroke-width="0.26" stroke-miterlimit="10"/>',
  },
  // Roo Code — the vendor's own repo asset. Rendering it confirmed it is the kangaroo mark (head,
  // ears, tail, legs), not a wordmark, so it is usable here. It is monochrome
  // (fill="currentColor") with no plate, so the panel tints it with the badge colour and it
  // reads on both themes.
  // Source: https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/src/assets/images/roo-logo.svg (HTTP 200 image/svg+xml; fetched 2026-11-25).
  // Source file 1189 B; body 1083 B; own background plate: no.
  // Root width/height dropped: yes (106/69). Declared colours: fill=none fill=currentColor.
  // The repo is Apache-2.0 (LICENSE fetched 2026-11-25: "Apache License Version 2.0 ... Copyright 2025
  // Roo Code, Inc."); its clause 6 grants no trademark rights, so the mark is used only to identify the tool.
  'roo': {
    viewBox: '0 0 106 69',
    title: 'Roo Code',
    body: '<path d="M88.4719 2.87946L86.5306 9.89906C86.4278 10.2707 86.0399 10.4854 85.6704 10.3752L53.106 0.659112C' +
      '52.8894 0.594492 52.6549 0.640312 52.4786 0.781722L20.2279 26.6445C20.1338 26.72 20.0214 26.7694 19.9021 2' +
      '6.7878L0.713159 29.745C0.357849 29.7998 0.10453 30.1187 0.13164 30.4772L0.21502 31.5798C0.24165 31.932 0.5' +
      '3052 32.2069 0.88359 32.216L23.1724 32.7922L23.4266 32.7993L39.8958 24.0019C40.1264 23.8788 40.4068 23.896' +
      '8 40.6197 24.0486L52.2875 32.3659C52.4705 32.4963 52.5783 32.7078 52.5762 32.9325L52.4778 43.9686C52.4765 ' +
      '44.1114 52.5197 44.2511 52.6014 44.3683L69.0144 67.9188C69.1431 68.1034 69.354 68.2135 69.5791 68.2135H74.' +
      '7748C75.2932 68.2135 75.6255 67.6623 75.3836 67.2039L63.6853 45.0427C63.5709 44.8259 63.5804 44.5647 63.71' +
      '01 44.3568L69.8094 34.5861C69.8758 34.4797 69.97 34.3935 70.0819 34.3367L91.8879 23.2712C92.1095 23.1588 9' +
      '2.3744 23.1745 92.5812 23.3123L98.8125 27.4657C98.9256 27.5411 99.0584 27.5813 99.1943 27.5813H104.856C105' +
      '.404 27.5813 105.732 26.9716 105.43 26.514L89.7099 2.6839C89.3844 2.19053 88.6294 2.30979 88.4719 2.87946Z' +
      '" fill="currentColor"/>',
  },
  // A mark the panel can draw for Qoder CN: qoder.cn serves a byte-identical copy of the
  // qoder.com favIcon.svg (both 73379 B, sha256 5e1843cb50c4...1dd0, fetched 2026-11-25), and the
  // CN rules directory is its own source key that never falls through to the qoder family, so the
  // chip needs its own entry. The body below is the qoder entry copy, not a second rendering.
  // Source: https://qoder.cn/favIcon.svg (HTTP 200 image/svg+xml; fetched 2026-11-25).
  // Source file 73379 B including the plate; body 2100 B; own background plate: no.
  // Copied from the qoder entry, fill="none" on the stroke-only ring included.
  // Qoder trademark; used only to identify the tool; licence UNVERIFIED.
  'qoder-cn': {
    viewBox: '0 0 206 206',
    title: 'Qoder CN',
    body: '<path fill="currentColor" fill-rule="evenodd" d="m104 36 50 27q9 4 13 13 5 8 5 19v63q0 9-7 1' +
      '3-6 4-14 1l-9-4-1 1h-1l-1 1h-1l-1 1h-2l-2 1h-1l-2 1-3 1h-2l-1 1h-16l-1-1h-1l-2-1h-2l-1-1h-1l' +
      '-49-26-1-1-7-4-2-3-1-2q-8-9-8-23V90l1-8v-1l1-4 1-3 2-4v-1l1-4h1v-1l2-3v-1l2-2 1-1 1-1v-1l3-3' +
      'v-1l1-1 1-1 4-3 5-4h1l3-3h1l3-2h2l5-2 3-1 6-1h13l1 1h1l3 1zm1 127 1 1h2l1 1h4l1 1h3l1-1h5l1-' +
      '1 4-1h2l1-1h2l1-1h1l1-1 1-1h1l1-1h5l11 5 5-1 2-4V95q0-16-13-24l-2-1h-2l-1-1h-11l-3 1-3 1h-2l' +
      '-1 1-2 1h-1v21l-1 3v2l-1 4v2l-1 2-1 3-1 2v1l-1 1v1l-1 2v1l-1 1-1 2-1 1-1 1v1h-1l-1 2v1l-2 1-' +
      '3 3-1 2h-1l-1 2h-1l-1 1v1h-1l-3 2-2 1q0 16 12 23m-20-11-2-13v-22l1-8v-1l1-3 1-4v-1l3-7 1-2 1' +
      '-2v-1h1l1-2 3-5h1v-1l1-1 7-7 3-2 1-1 1-1h1l4-2v-1h1l2-1h1l3-2h1l2-1 3-1h1L99 45h-1l-1-1h-1l-' +
      '1-1h-5v-1h-2l-2 1h-2l-4 1-3 1-4 1h-2v1h-1l-1 1h-1l-3 2-1 1-2 1-5 5h-1v1l-1 1-2 2-1 1v1h-1v1l' +
      '-2 2v1l-1 2-1 1v1l-1 2v1l-1 1-1 4v1l-1 1v3l-1 5v24a28 28 0 0 0 6 19l2 1 5 4zm8-24v-1l2-1 4-4' +
      ' 1-2 1-1 1-1v-1l1-1v-1l1-1 1-1v-1l1-2 1-1v-1l1-1v-1l1-2v-2l1-2v-3l1-1V79l-1 1-5 6h-1l-1 1-3 ' +
      '4-1 2v1l-2 3-2 4-1 3-1 4v2l-1 4v14" clip-rule="evenodd"/><path fill="none" stroke="currentColor" stroke-' +
      'width="3.5" d="m42 61-2 4h-1l-1 5-2 4v1l-1 2v2l-1 2v1l-1 8v23a38 38 0 0 0 9 25l2 3 8 5 49 26' +
      'h1l1 1h2v1h3l1 1h16l1-1h2l3-1 3-1 2-1h2l1-1h1l1-1h1l1-1 9 4q8 3 14-1t7-13V95q0-11-5-19a32 32' +
      ' 0 0 0-13-13l-50-27h-1l-2-1-3-1h-1l-1-1H84l-6 1-3 1-5 2h-2l-3 2h-1l-4 3-5 4-5 4-1 1v1l-3 3v1' +
      'l-2 2zm0 0Zm63 11-7 7-1 1v1h-1l-4 7h-1v1l-2 4-3 7v1l-1 4-1 3v1l-1 8v22l2 13-29-15-5-4-3-3q-5' +
      '-7-5-17V90l1-7v-2l1-2 1-4 1-2v-1l1-2 1-1 1-3 1-1 1-1v-1h1v-1l1-1 2-2 1-1 1-1v-1l5-4 3-2 3-2h' +
      '1l1-1h1v-1h1l5-1 3-1 4-1h2l4-1v1h5l1 1h1l2 1 29 15h-1l-3 1-2 1h-1l-3 2h-1l-3 1v1h-1l-4 2-1 1' +
      '-1 1zm0 0Zm-4-37Zm4 128h1l1 1h2l1 1h4l1 1h3l1-1h5l1-1 4-1h2l1-1h2l1-1h1l1-1 1-1h1l1-1h5l11 5' +
      ' 5-1 2-4V95q0-16-13-24l-2-1h-2l-1-1h-11l-3 1-3 1h-2l-1 1-2 1h-1v21l-1 3v2l-1 4v2l-1 2-1 3-1 ' +
      '2v1l-1 1v1l-1 2v1l-1 1-1 2-1 1-1 1v1h-1l-1 2v1l-2 1-3 3-1 2h-1l-1 2h-1l-1 1v1h-1l-3 2-2 1q0 ' +
      '16 12 23Zm-12-35h1v-1l2-1 4-4 1-2 1-1 1-1v-1l1-1v-1l1-1 1-1v-1l1-2 1-1v-1l1-1v-1l1-2v-2l1-2v' +
      '-3l1-1V79l-1 1-5 6h-1l-1 1-3 4-1 2v1l-2 3-2 4-1 3-1 4v2l-1 4z"/>',
  },
  // Devin publishes no press kit and no mark page; this is the favicon the site serves, and the
  // only vector asset reachable for the product. It is a single monochrome path with fill=black,
  // rewritten to currentColor so the chip can tint it on either theme. The site itself is only
  // intermittently reachable over TLS (schannel SEC_E_INVALID_TOKEN on most attempts).
  // Source: https://devin.ai/favicon.svg (HTTP 200 image/svg+xml; fetched 2026-11-25).
  // Source file 1405 B; body 1304 B; own background plate: no.
  // Root width/height dropped: yes (425/425). Declared colours: fill=none fill=currentColor.
  // Cognition/Devin trademark; used only to identify the tool; licence UNVERIFIED.
  'devin': {
    viewBox: '0 0 425 425',
    title: 'Devin',
    body:
      '<path d="M70 159.333V91.3471C70 88.3592 71.594 85.5983 74.1816 84.1044L133.043 50.1205C135.6' +
      '31 48.6265 138.819 48.6265 141.407 50.1205L200.269 84.1044C202.856 85.5983 204.45 88.3592 20' +
      '4.45 91.3471V126.068C204.708 137.606 210.806 148.734 221.531 154.926C232.256 161.117 244.942' +
      ' 160.834 255.063 155.289L285.132 137.929C287.719 136.435 290.907 136.435 293.495 137.929L352' +
      '.357 171.913C354.944 173.406 356.538 176.167 356.538 179.155V247.123C356.538 250.111 354.944' +
      ' 252.872 352.357 254.366L293.495 288.35C290.907 289.844 287.719 289.844 285.132 288.35L255.3' +
      '06 271.13C245.146 265.456 232.344 265.117 221.534 271.358C210.809 277.55 204.711 288.678 204' +
      '.453 300.215V334.926C204.453 337.914 202.859 340.675 200.271 342.169L141.41 376.153C138.822 ' +
      '377.647 135.634 377.647 133.046 376.153L74.1845 342.169C71.5969 340.675 70.0028 337.914 70.0' +
      '028 334.926V266.959C70.0029 263.971 71.5969 261.21 74.1845 259.716L133.046 225.732C135.634 2' +
      '24.238 138.822 224.238 141.41 225.732L171.547 243.132C181.656 248.638 194.306 248.906 205.00' +
      '5 242.729C215.815 236.488 221.922 225.231 222.088 213.595C221.83 202.057 215.732 189.737 205' +
      '.008 183.545C194.283 177.353 181.597 177.636 171.476 183.181L141.269 200.72C138.67 202.229 1' +
      '35.461 202.228 132.864 200.716L74.1576 166.562C71.5835 165.065 70 162.311 70 159.333Z" fill=' +
      '"currentColor"/>'
  },
};
