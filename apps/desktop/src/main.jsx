import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { setPdfTextAdapter } from '@flightsync/core/parsing/pdf-text'
import { installStrayDropGuard } from './utils/preventStrayDrops.js'

// Swallow file drops outside PdfDropZone so they can't navigate the WebView
// away from the app (WKWebView default drop handling — audit C2).
installStrayDropGuard()

// Lazy: the ~376 KB pdfjs stack loads on first PDF use instead of at boot
// (−530 KB of boot JS, audit #28). pdfToText awaits the adapter call, so an
// async adapter that dynamically imports the real one is transparent to callers.
setPdfTextAdapter(async (input) => {
  const { pdfTextWebkit } = await import('../adapters/pdf-text-webkit.js')
  return pdfTextWebkit(input)
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary onError={(error, info) => console.error('[error-boundary]', error, info?.componentStack)}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
