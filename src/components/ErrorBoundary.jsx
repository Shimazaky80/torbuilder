import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/* A render error inside one page used to unmount the whole tree, so the browser
   just showed a blank page with no way out. This keeps the app shell alive,
   shows what failed, and offers both a retry and a way back to the dashboard. */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surfaced in the browser console; there is no error reporting service wired up.
    console.error('Page render failed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <div className="page-error-boundary">
      <AlertTriangle size={26} />
      <h2>This screen could not be displayed</h2>
      <p>{error.message || 'An unexpected error occurred while rendering this page.'}</p>
      <div className="page-error-actions">
        <button type="button" className="secondary-btn" onClick={() => this.setState({ error: null })}><RotateCcw size={15} /> Try again</button>
        <button type="button" className="primary-btn" onClick={() => { window.location.href = '/dashboard'; }}>Go to dashboard</button>
      </div>
    </div>;
  }
}
