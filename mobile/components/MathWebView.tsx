import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
// NOTE: react-native-webview's documented API is a NAMED export, not a
// default export. A default import here (`import WebView from ...`) is
// `undefined` at runtime if there's no default export configured for this
// version — rendering an undefined component type can fail completely
// silently in some setups instead of showing an error, which would exactly
// match "nothing at all shows up, not even a plain hardcoded red box".
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

import { MathText } from '@/components/MathText';
import { colors } from '@/constants/theme';

/**
 * Renders a message with real, properly-typeset math — actual KaTeX (the
 * same engine ChatGPT/ClaudeAI-style apps use), not a native approximation.
 * A previous attempt at this (see git history) produced no visible output at
 * all on this app's Android test device, for reasons that were never pinned
 * down — the leading suspect is a WebView silently collapsing to 0 height
 * (a very common React Native gotcha, since a WebView has no natural content
 * size the way a Text does). This version measures the rendered page's real
 * height from inside the WebView and reports it back, and — since we can't
 * rule out some other silent failure on a device we can't inspect directly —
 * falls back to the native MathText renderer if the WebView doesn't report
 * back within a few seconds, so a rendering problem degrades to "looks
 * plainer" instead of "blank bubble".
 */
export function MathWebView({
  text,
  color = colors.text,
  fontSize = 15,
}: {
  text: string;
  color?: string;
  fontSize?: number;
}) {
  const [height, setHeight] = useState(fontSize * 1.6);
  const [status, setStatus] = useState<'loading' | 'ok' | 'failed'>('loading');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setStatus('loading');
    // TEMPORARY: stretched way out (was 5s) while we're actively diagnosing
    // why nothing showed up, so the on-page debug log (see buildHtml below)
    // stays visible on screen long enough to read/screenshot instead of
    // getting swapped out for the native fallback after a few seconds.
    timeoutRef.current = setTimeout(() => {
      setStatus((s) => (s === 'ok' ? s : 'failed'));
    }, 25000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [text]);

  const html = useMemo(() => buildHtml(text, color, fontSize), [text, color, fontSize]);
  // TEMPORARY: bypass everything above and load the simplest possible
  // static page — no JS, no network, nothing dynamic — to find out whether
  // a WebView can show ANYTHING at all in this build, before worrying about
  // KaTeX or our own scripts.
  const testHtml = '<html><body style="background:yellow"><h1 style="color:black;font-size:40px;">TEST 123</h1></body></html>';

  if (status === 'failed') {
    // KaTeX never confirmed it rendered — show the (still perfectly
    // readable) native version rather than an empty bubble.
    return <MathText text={text} color={color} fontSize={fontSize} />;
  }

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'height' && typeof data.height === 'number' && data.height > 0) {
        setHeight(data.height);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setStatus('ok');
      }
    } catch {
      // ignore malformed messages
    }
  };

  return (
    <View style={{ width: '100%' }}>
      <WebView
        key={text}
        originWhitelist={['*']}
        source={{ html: testHtml }}
        onMessage={onMessage}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        // TEMPORARY: androidLayerType="software" removed for this round —
        // it didn't fix the blank render, and on some Android WebView
        // versions "software" layer rendering is itself known to sometimes
        // paint nothing at all, so it's worth testing without it.
        // TEMPORARY: a fixed, generous, hardcoded height (ignoring the
        // measured `height` state) — to rule out "our own height-reporting
        // logic computed 0/something wrong" as the reason nothing showed,
        // separately from whether the WebView can render visible content at
        // all on this device/build.
        style={{ height: 160, width: '100%', backgroundColor: 'red' }}
      />
    </View>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Markdown **bold** -> <b>, blank-line-separated chunks -> <p>, single
 * newlines -> <br>. $...$ / $$...$$ math spans are left untouched — KaTeX's
 * auto-render extension finds and typesets those itself once the page
 * loads, so we don't need our own LaTeX parsing here at all. */
function toHtml(text: string): string {
  const escaped = escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

// TEMPORARY diagnostic build: the last two attempts at this both produced
// nothing visible, with no way to see why from outside the WebView. Rather
// than guess again, this version prints its own step-by-step log directly
// on the page (script started / each external resource's onload-or-onerror
// / whether KaTeX actually ran) so the real failure point shows up in a
// screenshot instead of staying invisible. Once we know what's actually
// happening this gets stripped back down to just the content.
function buildHtml(text: string, color: string, fontSize: number): string {
  const body = toHtml(text);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; background: ${colors.surface}; }
  body {
    color: ${color};
    font-size: ${fontSize}px;
    font-family: -apple-system, Roboto, sans-serif;
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  p { margin: 0 0 ${Math.round(fontSize * 0.7)}px 0; }
  p:last-child { margin-bottom: 0; }
  .katex { font-size: 1.05em; }
  .katex-display { margin: ${Math.round(fontSize * 0.4)}px 0; }
  #debug { font-size: 10px; color: #F97316; white-space: pre-wrap; margin-top: 10px; border-top: 1px solid #444; padding-top: 6px; font-family: monospace; }
</style>
</head>
<body dir="auto">
<div id="content">${body}</div>
<div id="debug">(debug log)</div>
<script>
  var lines = ['script tag reached'];
  function render() {
    var el = document.getElementById('debug');
    if (el) el.textContent = lines.join('\\n');
    post({ type: 'height', height: document.body.scrollHeight });
  }
  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }
  function dbg(line) { lines.push(line); render(); }
  window.onerror = function (msg, src, line, col) {
    dbg('window.onerror: ' + msg + ' @' + line + ':' + col);
    return false;
  };
  dbg('inline script ran, dir=' + document.body.dir);
  render();
</script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"
      onload="dbg('katex.css: loaded')" onerror="dbg('katex.css: FAILED TO LOAD')">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"
        onload="dbg('katex.js: loaded, typeof katex=' + (typeof katex))"
        onerror="dbg('katex.js: FAILED TO LOAD')"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
        onload="dbg('auto-render.js: loaded, typeof renderMathInElement=' + (typeof renderMathInElement));
                try {
                  renderMathInElement(document.getElementById('content'), {
                    delimiters: [
                      { left: '$$', right: '$$', display: true },
                      { left: '$', right: '$', display: false }
                    ],
                    throwOnError: false
                  });
                  dbg('renderMathInElement: ran with no exception');
                } catch (e) { dbg('renderMathInElement EXCEPTION: ' + e); }"
        onerror="dbg('auto-render.js: FAILED TO LOAD')"></script>
<script>
  setTimeout(function () { dbg('5s checkpoint: typeof katex=' + (typeof katex)); }, 5000);
  setTimeout(render, 300);
  setTimeout(render, 1500);
  setTimeout(render, 5500);
  window.addEventListener('resize', render);
</script>
</body>
</html>`;
}
