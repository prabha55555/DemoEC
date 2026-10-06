import React from 'react';
import { ErrorState, Button } from './ui';

// Catches a render crash inside one admin screen so the sidebar and top bar stay usable, and clears itself when
// the admin navigates to another screen (`resetKey` = the pathname).
export default class SectionBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="adm-card" style={{ marginTop: 8 }}>
        <ErrorState
          title="This screen hit a problem"
          message="Something went wrong while showing this page. Reloading usually fixes it; if it keeps happening, tell the developer which page it was."
          onRetry={() => window.location.reload()}
        />
        <div className="adm-empty-action" style={{ paddingBottom: 24 }}><Button to="/admin">Back to dashboard</Button></div>
      </div>
    );
  }
}
