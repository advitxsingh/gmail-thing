import React, { useEffect, useState, useMemo } from 'react';
import { loadGoogleScripts, initTokenClient, handleAuthClick, listLabels, listMessages, parseMessage, moveToInbox } from './services/gmailService';
import { AppState, GmailLabel, EnrichedMessage } from './types';
import Button from './components/Button';
import EmailCard from './components/EmailCard';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.AUTH_REQUIRED);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [selectedLabelId, setSelectedLabelId] = useState<string>('');
  const [emails, setEmails] = useState<EnrichedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const CLIENT_ID = '487017425814-pcueqe95kvbfv8671hc3j36f7ebhd880.apps.googleusercontent.com';

  // Auth State
  const [scriptsLoaded, setScriptsLoaded] = useState(false);

  // Filter state
  const [timeline, setTimeline] = useState<'all' | 'today' | '2days' | '7days' | 'custom'>('all');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('00:00');
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [endTime, setEndTime] = useState('23:59');

  useEffect(() => {
    loadGoogleScripts(() => {
      setScriptsLoaded(true);
      setStatusMsg('');
    });
  }, []);

  const handleLogin = async () => {
    try {
      initTokenClient(CLIENT_ID);
      await handleAuthClick();
      setAppState(AppState.SELECT_LABEL);
      fetchLabels();
    } catch (error: any) {
      console.error("Login failed", error);
      setStatusMsg(error?.message || 'Login failed or popup closed');
    }
  };

  // Auto-login removed as per user request

  const fetchLabels = async () => {
    try {
      const allLabels = await listLabels();
      // Remove duplicate labels and filter out empty/placeholder ones
      const uniqueLabels = Array.from(new Map(allLabels
        .filter(l => l.name && !l.name.includes('Select the'))
        .map(l => [l.id, l])).values());
      // Sort labels: folders first, then Alphabetical
      uniqueLabels.sort((a, b) => a.name.localeCompare(b.name));
      setLabels(uniqueLabels);
    } catch (error: any) {
      console.error('Fetch labels failed:', error);
      const isAuthError = error?.result?.error?.code === 401 || error?.result?.error?.status === 'UNAUTHENTICATED';
      setStatusMsg(isAuthError
        ? 'Authentication expired. Please sign in again.'
        : `Error: ${error?.result?.error?.message || 'Failed to fetch labels'}`
      );
      if (isAuthError) setAppState(AppState.AUTH_REQUIRED);
    }
  };

  const startScanning = async () => {
    if (!selectedLabelId) return;
    setAppState(AppState.LOADING_EMAILS);
    setIsLoading(true);
    setStatusMsg('Scanning label timeline...');

    try {
      let afterDateStr = '';
      let beforeDateStr = '';

      if (timeline === 'custom') {
        const start = new Date(`${startDate}T${startTime}:00`);
        const end = new Date(`${endDate}T${endTime}:59`);
        // Convert to Unix timestamps in seconds
        afterDateStr = Math.floor(start.getTime() / 1000).toString();
        beforeDateStr = Math.floor(end.getTime() / 1000).toString();
      } else if (timeline !== 'all') {
        const d = new Date();
        if (timeline === 'today') d.setHours(0, 0, 0, 0);
        else if (timeline === '2days') d.setDate(d.getDate() - 2);
        else if (timeline === '7days') d.setDate(d.getDate() - 7);
        afterDateStr = d.toISOString().split('T')[0].replace(/-/g, '/');
      }

      const selectedLabel = labels.find(l => l.id === selectedLabelId);
      const labelName = selectedLabel?.name || '';

      const scanResult = await listMessages(selectedLabelId, labelName, 30000, afterDateStr, beforeDateStr);
      const parsed = scanResult.messages.map(m => parseMessage(m, scanResult.historyRange));

      parsed.sort((a, b) => {
        // If both were added recently, sort by the action time
        if (a.labelAddedAt && b.labelAddedAt) return b.labelAddedAt - a.labelAddedAt;

        // If only one was added recently, it stays on top
        if (a.labelAddedAt && !b.labelAddedAt) return -1;
        if (!a.labelAddedAt && b.labelAddedAt) return 1;

        // Otherwise sort by original arrival timestamp
        return b.timestamp - a.timestamp;
      });

      if (parsed.length === 0) {
        setStatusMsg("No recent actions found. Checking label contents directly...");
        // If history found nothing, search the label by name
        const fallbackRaw = await window.gapi.client.gmail.users.messages.list({
          userId: 'me',
          q: `label:"${labelName}"`,
          maxResults: 50
        });
        if (fallbackRaw.result.messages) {
          const detailPromises = fallbackRaw.result.messages.map((m: any) =>
            window.gapi.client.gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata' })
          );
          const details = await Promise.all(detailPromises);
          const fallbackParsed = details.map(res => parseMessage(res.result));
          setEmails(fallbackParsed);
          setStatusMsg(`History scan was empty. Showing last 50 label items instead.`);
        } else {
          setEmails([]);
          setStatusMsg("No emails found in this label at all.");
        }
      } else {
        setEmails(parsed);
        setStatusMsg(`Found ${parsed.length} emails. Check the "Added @" badges!`);
      }
    } catch (error: any) {
      console.error('Scan failed:', error);
      setStatusMsg(`Scan Failed: ${error?.message || 'Check your internet or Gmail permissions'}`);
    } finally {
      setIsLoading(false);
    }
  };


  const toggleSelection = (id: string) => {
    setEmails(prev => prev.map(e => e.id === id ? { ...e, selected: !e.selected } : e));
  };

  const selectAll = () => {
    const allSelected = emails.every(e => e.selected);
    setEmails(prev => prev.map(e => ({ ...e, selected: !allSelected })));
  }

  const handleRecover = async () => {
    const toRecover = emails.filter(e => e.selected);
    if (toRecover.length === 0) return;

    setIsLoading(true);
    setStatusMsg(`Moving ${toRecover.length} emails to Inbox...`);

    try {
      const ids = toRecover.flatMap(e => e.allMessageIds);
      await moveToInbox(ids, selectedLabelId);

      // Update UI
      setEmails(prev => prev.filter(e => !ids.includes(e.id)));
      setStatusMsg(`Success! ${toRecover.length} emails recovered to Inbox.`);
      setTimeout(() => setStatusMsg(''), 5000);
    } catch (error) {
      setStatusMsg('Failed to move emails. Check console.');
    } finally {
      setIsLoading(false);
    }
  };

  // Derived state for sorting
  const sortedEmails = useMemo(() => {
    return [...emails].sort((a, b) => b.timestamp - a.timestamp);
  }, [emails]);

  const selectedCount = emails.filter(e => e.selected).length;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      {/* Header */}
      <header className="mb-12 text-center">
        <h1 className="text-4xl font-bold text-white mb-2">
          Gmail WooHehe
        </h1>
        {statusMsg && (
          <div className="mt-4 inline-block px-3 py-1 rounded-full bg-black text-xs text-white border border-white/20">
            {statusMsg}
          </div>
        )}
      </header>

      {/* View: Auth */}
      {appState === AppState.AUTH_REQUIRED && (
        <div className="flex flex-col items-center justify-center p-8 bg-black rounded-2xl border border-white/10 max-w-lg mx-auto">
          <div className="w-16 h-16 bg-black border border-white/10 rounded-full flex items-center justify-center mb-6">
            <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
            </svg>
          </div>

          <h2 className="text-xl font-semibold mb-6">Connect your Gmail</h2>

          <div className="w-full space-y-4">
            <Button
              onClick={handleLogin}
              className="w-full py-4 text-lg font-bold"
              disabled={!scriptsLoaded}
            >
              {scriptsLoaded ? 'Sign in with Google' : 'Initializing...'}
            </Button>
          </div>
        </div>
      )}

      {/* View: Select Label */}
      {appState === AppState.SELECT_LABEL && (
        <div className="flex flex-col max-w-lg mx-auto glass-card animate-fade-in border-white/10">
          <h2 className="text-xl font-bold mb-6 text-white">Filter by Label & Timeline</h2>

          <label className="block text-sm font-medium text-white/40 mb-2">
            Which label contains the accidental archives?
          </label>

          <div className="relative mb-6">
            <select
              className="appearance-none w-full bg-black border border-white/10 rounded-xl px-4 py-4 text-white hover:border-white/40 focus:border-white outline-none transition-all cursor-pointer"
              value={selectedLabelId}
              onChange={(e) => setSelectedLabelId(e.target.value)}
            >
              <option value="" disabled>Search & select the "Bad" Label...</option>
              {labels.map(l => (
                <option key={l.id} value={l.id}>
                  {l.type === 'system' ? '📁 ' : '🏷️ '} {l.name}
                </option>
              ))}
            </select>
          </div>

          <label className="block text-sm font-medium text-white/40 mb-2">
            When did the filter run? (Limit scan area)
          </label>
          <div className="grid grid-cols-5 gap-2 mb-4">
            {[
              { id: 'today', label: 'Today' },
              { id: '2days', label: '48h' },
              { id: '7days', label: 'Week' },
              { id: 'custom', label: 'Custom' },
              { id: 'all', label: 'All' }
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTimeline(t.id as any)}
                className={`py-2 text-[10px] uppercase tracking-wider font-black rounded-lg border transition-all ${timeline === t.id ? 'bg-white text-black border-white' : 'bg-black border-white/10 text-white hover:border-white/40'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {timeline === 'custom' && (
            <div className="time-range-container animate-fade-in">
              <div className="flex items-start gap-4">
                <div className="time-slot">
                  <label>Range Start</label>
                  <div className="time-input-group">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                    />
                  </div>
                </div>

                <div className="time-separator italic font-light">to</div>

                <div className="time-slot">
                  <label>Range End</label>
                  <div className="time-input-group">
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <Button
            disabled={!selectedLabelId}
            onClick={startScanning}
            isLoading={isLoading}
            className="w-full py-4 text-lg"
          >
            Scan Filtered Timeline
          </Button>
        </div>
      )}

      {/* View: Review Emails */}
      {(appState === AppState.REVIEW_EMAILS || appState === AppState.PROCESSING_RECOVERY || appState === AppState.LOADING_EMAILS) && (
        <div className="flex flex-col h-[700px] gap-6 animate-fade-in">

          {/* Recovery Stats Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-card !p-4 flex flex-col items-center justify-center bg-black border-white/10">
              <span className="text-white/50 text-xs uppercase font-bold tracking-wider mb-1">Found in Label</span>
              <span className="text-2xl font-black text-white">{emails.length}</span>
            </div>
            <div className="glass-card !p-4 flex flex-col items-center justify-center border-white/10">
              <span className="text-white/50 text-xs uppercase font-bold tracking-wider mb-1">Currently Selected</span>
              <span className="text-2xl font-black text-white">{selectedCount}</span>
            </div>
          </div>

          {/* Timeline Control Center */}
          <div className="glass-card !p-6 border-white/10 bg-black">
            <h3 className="text-sm font-bold text-white/60 mb-4 flex items-center gap-2">
              <span className="text-lg">🕒</span> Timeline Controller
            </h3>

            <div className="flex flex-wrap gap-2">
              <button
                className="text-[11px] px-3 py-1.5 rounded-full font-bold bg-black text-white border border-white/10 cursor-default"
              >
                SORTING BY LATEST
              </button>

              <div className="h-4 w-[1px] bg-white/10 mx-2 self-center"></div>

              <button
                onClick={() => selectAll()}
                className="text-[11px] px-4 py-1.5 rounded-full bg-white text-black hover:bg-neutral-200 transition-all font-black uppercase tracking-wider"
              >
                SELECT ALL
              </button>
              <button
                onClick={() => setAppState(AppState.SELECT_LABEL)}
                className="text-[11px] px-3 py-1.5 rounded-full bg-black text-white/40 hover:text-white border border-white/10 transition-all font-bold ml-auto"
              >
                CHANGE TIMELINE
              </button>
            </div>
          </div>

          {/* Email List Header */}
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-4">
              <h4 className="text-sm font-bold text-white/30 uppercase tracking-widest">Matches</h4>
              <div className="text-xs text-white/20">Showing {emails.length} items</div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={selectAll} className="text-[11px] uppercase font-bold tracking-widest text-neutral-400 hover:text-white">
                {emails.length > 0 && emails.every(e => e.selected) ? "Clear All" : "Select All"}
              </Button>
              {selectedCount > 0 && (
                <Button onClick={handleRecover} isLoading={isLoading} className="!h-8 !px-4 !text-[11px] !bg-white !text-black hover:!bg-neutral-200 rounded-full border-none font-bold uppercase tracking-widest">
                  Recover {selectedCount} to Inbox
                </Button>
              )}
            </div>
          </div>

          {/* List Section */}
          <div className="flex-1 overflow-y-auto pr-2 space-y-3 min-h-0 custom-scrollbar pb-8">
            {isLoading && emails.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-white glass-card">
                <div className="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin mb-4"></div>
                <p className="animate-pulse">Retrieving label content...</p>
              </div>
            ) : sortedEmails.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-white glass-card">
                <div className="text-4xl mb-4">🔍</div>
                <p>No matches found in this label.</p>
                <button onClick={() => setAppState(AppState.SELECT_LABEL)} className="text-white underline mt-4 font-bold text-xs uppercase tracking-widest transition-all">← Choose different label</button>
              </div>
            ) : (
              sortedEmails.map(email => (
                <EmailCard
                  key={email.id}
                  email={email}
                  onToggle={toggleSelection}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;