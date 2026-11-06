'use client';

import React, { useState } from 'react';
import axios from 'axios';

import Header from '@/components/Header';
import UploadZone from '@/components/UploadZone';
import MyInstagram from '@/components/MyInstagram';
import TrackRecord from '@/components/TrackRecord';
import VideoPreview from '@/components/VideoPreview';
import LoadingSpinner from '@/components/LoadingSpinner';
import AnalysisResults from '@/components/AnalysisResults';
import { getVideoMetadata } from '@/lib/validators';
import { pickText, useLang } from '@/lib/i18n';
import type { VideoMetadata, UploadResponse } from '@/types/video';
import type { ActualPerformance, AnalysisResult, AnalysisStage, AnalyzeStartResponse, AnalyzeStatusResponse } from '@/types/analysis';

export default function Home() {
  const { t, lang } = useLang();
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | undefined>(undefined);
  const [analysisState, setAnalysisState] = useState<'idle' | 'analyzing' | 'complete'>('idle');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<AnalysisStage>('signals');
  const [startedAt, setStartedAt] = useState(0);
  const [analyzedFileId, setAnalyzedFileId] = useState<string | null>(null);
  const [isEditEstimate, setIsEditEstimate] = useState(false);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setUploadPercent(0);

    try {
      // Create FormData
      const formData = new FormData();
      formData.append('file', selectedFile);

      // Upload file
      // No Content-Type header on purpose: the browser writes
      // "multipart/form-data; boundary=..." itself, and pinning it here drops
      // the boundary — the server then fails with "expected boundary after body"
      const response = await axios.post<UploadResponse>('/api/upload', formData, {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            setUploadPercent(Math.round((progressEvent.loaded * 100) / progressEvent.total));
          }
        },
      });

      if (response.data.success && response.data.data) {
        // Server response lacks duration/dimensions — measure them client-side
        let measured = { duration: 0, width: 0, height: 0, aspectRatio: '' };
        try {
          measured = await getVideoMetadata(selectedFile);
        } catch {
          // best effort — analysis re-measures server-side anyway
        }
        setMetadata({
          ...response.data.data,
          duration: measured.duration,
          width: measured.width,
          height: measured.height,
          aspectRatio: measured.aspectRatio
        });
      } else {
        throw new Error(response.data.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload video');
      setFile(null);
    } finally {
      setUploadPercent(undefined);
    }
  };

  const runAnalysis = async (fileId: string, actual?: ActualPerformance, editEstimate = false) => {
    setAnalyzedFileId(fileId);
    setIsEditEstimate(editEstimate);
    setAnalysisState('analyzing');
    setError(null);
    setStage('signals');
    setStartedAt(Date.now());

    try {
      // Start the job, then poll — short requests survive the ~100s proxy
      // timeouts of free hosts, unlike one multi-minute analyze call
      const startResponse = await axios.post<AnalyzeStartResponse>('/api/analyze/start', {
        fileId,
        actual
      });
      if (!startResponse.data.success || !startResponse.data.jobId) {
        throw new Error(startResponse.data.error || 'Analysis failed');
      }
      const jobId = startResponse.data.jobId;

      const deadline = Date.now() + 12 * 60 * 1000;
      let consecutiveFailures = 0;
      let finished = false;
      while (!finished) {
        if (Date.now() > deadline) throw new Error('Analysis timed out. Please try again.');
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
          const statusResponse = await axios.get<AnalyzeStatusResponse>('/api/analyze/status', {
            params: { job: jobId }
          });
          consecutiveFailures = 0;
          const payload = statusResponse.data;
          if (payload.status === 'done' && payload.data) {
            setAnalysisResult(payload.data);
            setAnalysisState('complete');
            finished = true;
          } else if (payload.status === 'running') {
            // The server reports where the pipeline actually is
            if (payload.stage) setStage(payload.stage);
          } else if (payload.status === 'error') {
            throw new Error(payload.error || 'Analysis failed');
          }
        } catch (pollError) {
          if (axios.isAxiosError(pollError) && !pollError.response) {
            // network blip or the instance waking from sleep — tolerate a few
            consecutiveFailures += 1;
            if (consecutiveFailures >= 5) throw pollError;
          } else {
            throw pollError;
          }
        }
      }
    } catch (err) {
      console.error('Analysis error:', err);
      const message = axios.isAxiosError(err) && err.response?.data?.error
        ? String(err.response.data.error)
        : err instanceof Error ? err.message : 'Analysis failed. Please try again.';
      setError(message);
      setAnalysisState('idle');
    }
  };

  const handleAnalyze = () => {
    if (metadata) runAnalysis(metadata.fileId);
  };

  // Analyze a reel straight from the cached Instagram snapshot,
  // carrying its real stats so the AI can reconcile prediction vs reality
  const handleAnalyzeInstagramReel = (fileId: string, label: string, actual: ActualPerformance) => {
    setMetadata({
      fileId,
      filename: label,
      duration: 0,
      size: 0,
      format: 'mp4',
      thumbnailUrl: '',
      aspectRatio: '9:16',
      width: 1080,
      height: 1920
    });
    runAnalysis(fileId, actual);
  };

  const handleReset = () => {
    setFile(null);
    setMetadata(null);
    setAnalysisState('idle');
    setAnalysisResult(null);
    setError(null);
  };

  const handleDownloadReport = () => {
    if (!analysisResult || !metadata) return;

    const technical = analysisResult.technical;
    const extraSections: string[] = [];

    if (analysisResult.hook && (analysisResult.hook.transcript || analysisResult.hook.verdict)) {
      extraSections.push([
        'HOOK (FIRST 3 SECONDS):',
        analysisResult.hook.transcript ? `- Heard/shown: "${analysisResult.hook.transcript}"` : null,
        analysisResult.hook.verdict ? `- Verdict: ${pickText(analysisResult.hook.verdict, lang)}` : null,
        `- Visual cuts: ${analysisResult.hook.cutsInFirstThreeSeconds}`
      ].filter(Boolean).join('\n'));
    }

    if (technical) {
      extraSections.push([
        'TECHNICAL SIGNALS (measured locally with ffmpeg):',
        `- Resolution: ${technical.width}x${technical.height} (${technical.aspectRatio}) @ ${technical.fps} fps`,
        `- Duration: ${technical.duration}s (${technical.durationFit})`,
        `- Cuts: ${technical.cutCount} (${technical.cutsPerMinute}/min, avg shot ${technical.avgShotSeconds}s)`,
        `- Loudness: ${technical.loudnessLufs === null ? 'no audio' : `${technical.loudnessLufs} LUFS (target -14)`}`,
        `- Silence spans >=1s: ${technical.silences.length}`
      ].join('\n'));
    }

    if (analysisResult.performanceReview && analysisResult.actual) {
      const rc = analysisResult.performanceReview;
      const verdictLabel = rc.verdict === 'overperformed' ? t('rcVerdictOver')
        : rc.verdict === 'underperformed' ? t('rcVerdictUnder') : t('rcVerdictExpected');
      extraSections.push([
        `${t('rcTitle').toUpperCase()} — ${verdictLabel}:`,
        `- ${t('rcActual')}: ${analysisResult.actual.views} ${t('igViews')} · ${analysisResult.actual.reach} ${t('rcReach')} · ${analysisResult.actual.shares} shares`,
        `${t('rcWhy')}:`,
        ...rc.whyItHappened.map(x => `- ${pickText(x, lang)}`),
        `${t('rcNext')}:`,
        ...rc.whatToDoNext.map(x => `- ${pickText(x, lang)}`)
      ].join('\n'));
    }

    if (analysisResult.transcript) {
      extraSections.push(`TRANSCRIPT:\n${analysisResult.transcript}`);
    }

    if (analysisResult.suggestedCaption || analysisResult.hashtags?.length) {
      extraSections.push([
        'CAPTION IDEA:',
        pickText(analysisResult.suggestedCaption, lang),
        analysisResult.hashtags?.length ? analysisResult.hashtags.join(' ') : ''
      ].filter(Boolean).join('\n'));
    }

    const report = `
INSTAGRAM REELS VIRALITY ANALYSIS REPORT
----------------------------------------
Date: ${new Date().toLocaleString()}
Filename: ${metadata.filename}
Duration: ${metadata.duration ? `${Math.round(metadata.duration)}s` : 'n/a'}
Analyzed with: ${analysisResult.provider === 'open' ? 'Premium AI' : analysisResult.provider === 'gemini' ? 'Backup AI' : 'Measured signals only'}
----------------------------------------

VIRALITY SCORE: ${analysisResult.viralityScore}/100
Level: ${analysisResult.viralityScore >= 80 ? 'Very High' : analysisResult.viralityScore >= 60 ? 'High' : 'Moderate'}

METRICS:
- Hook Strength: ${analysisResult.metrics.hookStrength}/10
- Visual Quality: ${analysisResult.metrics.visualQuality}/10
- Pacing & Retention: ${analysisResult.metrics.pacing}/10
- Trending Elements: ${analysisResult.metrics.trendingElements}/10
- Engagement CTA: ${analysisResult.metrics.engagementCTA}/10
- Rewatch Potential: ${analysisResult.metrics.rewatchPotential}/10

ESTIMATES:
- Reach: ${analysisResult.estimatedReach}
- Engagement Rate: ${analysisResult.engagementRate}
- Best Time to Post: ${analysisResult.bestPostTime}

STRENGTHS:
${analysisResult.strengths.map(s => `- ${pickText(s, lang)}`).join('\n') || '- (none listed)'}

IMPROVEMENTS:
${analysisResult.improvements.map(i => `- ${pickText(i, lang)}`).join('\n') || '- (none listed)'}

RECOMMENDATIONS:
${analysisResult.recommendations.map(r => `- ${pickText(r, lang)}`).join('\n')}

${extraSections.join('\n\n')}

SUMMARY:
${pickText(analysisResult.summary, lang)}
    `.trim();

    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `virality-report-${metadata.filename}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen pb-20 bg-gradient-to-br from-gray-900 via-black to-gray-900">
      <Header />

      <main className="container mx-auto px-4 pt-8">
        {/* Error Banner */}
        {error && (
          <div className="max-w-2xl mx-auto mb-8 p-4 bg-red-500/10 border border-red-500/50 rounded-xl flex items-center gap-3 text-red-200">
            <svg className="w-6 h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p>{error}</p>
            <button onClick={() => setError(null)} className="ml-auto hover:text-white">✕</button>
          </div>
        )}

        {/* State Machine UI */}
        {analysisState === 'idle' && !file && (
          <div className="animate-fade-in">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                {t('heroTitle')}
              </h2>
              <p className="text-xl text-gray-400 max-w-2xl mx-auto">
                {t('heroSub')}
              </p>
            </div>
            <UploadZone
              onFileSelect={handleFileSelect}
              isUploading={uploadPercent !== undefined}
            />
            <MyInstagram onAnalyzeReel={handleAnalyzeInstagramReel} />
            <TrackRecord />
          </div>
        )}

        {analysisState === 'idle' && file && (
          <div className="animate-fade-in">
            <VideoPreview
              file={file}
              metadata={metadata || undefined}
              onRemove={handleReset}
              onAnalyze={handleAnalyze}
              uploadPercent={uploadPercent}
            />
          </div>
        )}

        {analysisState === 'analyzing' && (
          <div className="animate-fade-in">
            <LoadingSpinner stage={stage} startedAt={startedAt} />
          </div>
        )}

        {analysisState === 'complete' && analysisResult && (
          <AnalysisResults
            result={analysisResult}
            onAnalyzeAnother={handleReset}
            onDownloadReport={handleDownloadReport}
            fileId={analyzedFileId ?? undefined}
            onReanalyze={editedFileId => runAnalysis(editedFileId, undefined, true)}
            isEditEstimate={isEditEstimate}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="w-full py-8 text-center text-gray-600 text-sm mt-auto">
        <p>{t('footer')}</p>
      </footer>
    </div>
  );
}
