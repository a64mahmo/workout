'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function FitbitCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setStatus('error');
      setError(errorParam === 'access_denied' ? 'You denied access to Fitbit.' : errorParam);
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setError('Missing authorization code or state parameter.');
      return;
    }

    api
      .post('/api/fitbit/callback', { code, state })
      .then(() => {
        setStatus('success');
        setTimeout(() => router.push('/settings'), 1500);
      })
      .catch((err) => {
        setStatus('error');
        setError(err.response?.data?.detail || 'Failed to connect Fitbit.');
      });
  }, [searchParams, router]);

  return (
    <div className="max-w-md mx-auto py-20 text-center space-y-6">
      {status === 'loading' && (
        <>
          <Loader2 className="size-10 animate-spin mx-auto text-primary" />
          <div>
            <p className="font-semibold">Connecting to Fitbit…</p>
            <p className="text-sm text-muted-foreground mt-1">Please wait while we set up your integration.</p>
          </div>
        </>
      )}

      {status === 'success' && (
        <>
          <CheckCircle2 className="size-10 mx-auto text-emerald-500" />
          <div>
            <p className="font-semibold">Fitbit Connected!</p>
            <p className="text-sm text-muted-foreground mt-1">Redirecting to settings…</p>
          </div>
        </>
      )}

      {status === 'error' && (
        <>
          <XCircle className="size-10 mx-auto text-destructive" />
          <div>
            <p className="font-semibold">Connection Failed</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
          <Button onClick={() => router.push('/settings')} variant="outline">
            Back to Settings
          </Button>
        </>
      )}
    </div>
  );
}
