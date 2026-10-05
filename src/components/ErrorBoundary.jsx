import React from 'react';

// Catches any render-time crash anywhere below it and shows a visible, actionable
// fallback instead of leaving the page silently blank. Without this, a crash during
// render unmounts the entire tree with nothing left on screen -- indistinguishable,
// from a visitor's point of view, from the page simply failing to load at all.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Render error caught by ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F1F8F6', padding: 24, textAlign: 'center' }}>
          <div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 22, fontWeight: 600, fontStyle: 'normal', color: '#1F2A28', marginBottom: 20 }}>
              Something went wrong loading this page.
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => window.location.reload()}
                style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 14, padding: '13px 30px', background: '#0F766E', color: '#fff', border: 'none', borderRadius: 999, cursor: 'pointer' }}
              >
                Reload
              </button>
              {/* Plain <a>, not a router Link -- this boundary sits outside
                  BrowserRouter (see App.jsx) specifically so it can catch a crash
                  anywhere in the tree, including inside the router itself, so no
                  client-side navigation is available here. A full page load to "/"
                  also gives the app a clean remount, which a crash recovery should
                  want anyway. Previously the only way out of this screen at all was
                  a full reload -- there was no way to leave the broken page/route. */}
              <a
                href="/"
                style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 14, padding: '13px 30px', background: '#fff', color: '#0F766E', border: '1.5px solid #B6E3DD', borderRadius: 999, textDecoration: 'none', display: 'inline-block' }}
              >
                Go to Home
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
