'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import type { User } from '@/types';
import { Activity, Link2, Link2Off, Heart, Moon, Weight, Loader2 } from 'lucide-react';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.get('/api/auth/me');
      return res.data;
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get('/api/fitbit/auth-url');
      return res.data.url as string;
    },
    onSuccess: (url) => {
      setConnecting(true);
      window.location.href = url;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await api.post('/api/fitbit/disconnect');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const isConnected = user?.has_fitbit_connected;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account and integrations
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <Activity className="size-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-base">Fitbit Integration</h2>
            <p className="text-xs text-muted-foreground">
              Sync heart rate, sleep, and weight data from your Fitbit device
            </p>
          </div>
          {isConnected !== undefined && (
            <Badge variant={isConnected ? 'default' : 'secondary'}>
              {isConnected ? 'Connected' : 'Not connected'}
            </Badge>
          )}
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Heart className="size-4 text-red-500" />
              <span>Heart Rate</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Moon className="size-4 text-indigo-500" />
              <span>Sleep</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Weight className="size-4 text-amber-500" />
              <span>Weight</span>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          {isLoading ? (
            <div className="h-10 rounded-lg bg-muted animate-pulse" />
          ) : isConnected ? (
            <Button
              variant="outline"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="gap-2 w-full justify-center cursor-pointer"
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2Off className="size-4" />
              )}
              Disconnect Fitbit
            </Button>
          ) : (
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending || connecting}
              className="gap-2 w-full justify-center cursor-pointer"
            >
              {connectMutation.isPending || connecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              Connect Fitbit
            </Button>
          )}
        </div>

        {isConnected && (
          <div className="border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Your Fitbit account is linked. Heart rate, sleep, and weight data will be
              synced automatically when you use the Sync button on a completed session.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
