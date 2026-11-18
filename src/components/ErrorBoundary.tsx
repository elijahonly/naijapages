import React from 'react';

interface State {
  hasError: boolean;
}

/** Last line of defence: shows a friendly page instead of a blank screen if something unexpected breaks. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[naijapages] unexpected error:', error.name);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <div className="max-w-md text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-8">
          <div className="text-4xl mb-3">🛠️</div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Sorry about that. Please reload the page. If the problem keeps happening, let us know through the Contact page.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl"
            >
              Reload page
            </button>
            <a href="#/" onClick={() => this.setState({ hasError: false })} className="px-5 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl">
              Go home
            </a>
          </div>
        </div>
      </div>
    );
  }
}
