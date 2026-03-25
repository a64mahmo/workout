'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import type { TrainingSession, MesoCycle } from '@/types';
import { format } from 'date-fns';
import { Plus, Dumbbell, Flame, ChevronRight, Form } from 'lucide-react';

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000';

function sessionVolume(session: TrainingSession): number {
  return (
    session.exercises?.reduce(
      (t, se) => t + se.sets.reduce((s, set) => s + set.reps * set.weight, 0),
      0
    ) ?? 0
  );
}

export default function SessionsPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newSession, setNewSession] = useState({
    name: '',
    meso_cycle_id: '',
    scheduled_date: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
  });
  const queryClient = useQueryClient();
  const router = useRouter();
  const [userId] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('userId');
      if (!stored || stored === 'default-user') {
        localStorage.setItem('userId', DEFAULT_USER_ID);
        return DEFAULT_USER_ID;
      }
      return stored;
    }
    return DEFAULT_USER_ID;
  });

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['sessions', userId],
    queryFn: async () => {
      const res = await api.get(`/api/sessions?user_id=${userId}`);
      return res.data as TrainingSession[];
    },
  });

  const { data: cycles } = useQuery({
    queryKey: ['cycles', userId],
    queryFn: async () => {
      const res = await api.get(`/api/meso-cycles?user_id=${userId}`);
      return res.data as MesoCycle[];
    },
  });

  useEffect(() => {
    if (cycles?.length === 1 && newSession.meso_cycle_id !== cycles[0].id) {
      setNewSession((prev) => ({ ...prev, meso_cycle_id: cycles[0].id }));
    }
  }, [cycles, newSession.meso_cycle_id]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof newSession) => {
      const res = await api.post(`/api/sessions?user_id=${userId}`, data);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', userId] });
      setIsDialogOpen(false);
      setNewSession({
        name: '',
        meso_cycle_id: cycles?.length === 1 ? cycles[0].id : '',
        scheduled_date: format(new Date(), 'yyyy-MM-dd'),
        notes: '',
      });
      router.push(`/sessions/${data.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/sessions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', userId] });
    },
  });

  const upcoming = sessions?.filter((s) => s.status === 'scheduled') ?? [];
  const completed = sessions?.filter((s) => s.status !== 'scheduled') ?? [];

  const canCreate =
    !!newSession.name &&
    !!newSession.meso_cycle_id &&
    !!newSession.scheduled_date;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Sessions</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {upcoming.length} upcoming · {completed.length} completed
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger
            render={
              <Button className="gap-2">
                <Plus className="size-4" />
                New Session
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Session</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <Input
                placeholder="Session name"
                value={newSession.name}
                onChange={(e) =>
                  setNewSession({ ...newSession, name: e.target.value })
                }
              />
              <Select
                value={newSession.meso_cycle_id}
                onValueChange={(value) =>
                  value && setNewSession({ ...newSession, meso_cycle_id: value })
                }
                items={cycles?.map((cycle) => ({ value: cycle.id, label: cycle.name }))}
              >
                <SelectTrigger className="w-full h-10">
                  <SelectValue placeholder="Select a meso cycle" />
                </SelectTrigger>
                <SelectContent>
                  {cycles?.map((cycle) => (
                    <SelectItem key={cycle.id} value={cycle.id} label={cycle.name}>
                      {cycle.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={newSession.scheduled_date}
                onChange={(e) =>
                  setNewSession({
                    ...newSession,
                    scheduled_date: e.target.value,
                  })
                }
              />
              <Input
                placeholder="Notes (optional)"
                value={newSession.notes}
                onChange={(e) =>
                  setNewSession({ ...newSession, notes: e.target.value })
                }
              />
              <Button
                className="w-full"
                onClick={() => canCreate && createMutation.mutate(newSession)}
                disabled={createMutation.isPending || !canCreate}
              >
                {createMutation.isPending ? 'Creating...' : 'Create & Open →'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : sessions && sessions.length > 0 ? (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                Upcoming
              </h2>
              <div className="space-y-2">
                {upcoming.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    onView={() => router.push(`/sessions/${session.id}`)}
                    onDelete={() => deleteMutation.mutate(session.id)}
                  />
                ))}
              </div>
            </section>
          )}
          {completed.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                Completed
              </h2>
              <div className="space-y-2">
                {completed.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    onView={() => router.push(`/sessions/${session.id}`)}
                    onDelete={() => deleteMutation.mutate(session.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
            <Dumbbell className="size-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium">No sessions yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first session to start tracking
            </p>
          </div>
          <Button className="gap-2" onClick={() => setIsDialogOpen(true)}>
            <Plus className="size-4" />
            Create Session
          </Button>
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  onView,
  onDelete,
}: {
  session: TrainingSession;
  onView: () => void;
  onDelete: () => void;
}) {
  const vol = sessionVolume(session);
  const exerciseCount = session.exercises?.length ?? 0;


  const { dayNum, monthStr } = useMemo(() => {
    let dn = '';
    let ms = '';
    try {
      const d = new Date(session.scheduled_date + 'T00:00:00');
      dn = format(d, 'd');
      ms = format(d, 'MMM');
    } catch {}
    return { dayNum: dn, monthStr: ms };
  }, [session.scheduled_date]);

  return (
    <div className="group flex items-center gap-1 rounded-xl border border-border bg-card hover:bg-muted/40 transition-colors">
      <button
        onClick={onView}
        className="flex items-center gap-4 flex-1 px-4 py-3.5 text-left"
      >
        {/* Date block */}
        <div className="text-center w-10 shrink-0">
          <div className="text-xl font-bold leading-none tabular-nums">{dayNum}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide mt-0.5">
            {monthStr}
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-border shrink-0" />

        {/* Session info */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{session.name}</div>
          <div className="flex items-center gap-3 mt-0.5">
            {exerciseCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''}
              </span>
            )}
            {vol > 0 && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Flame className="size-3 text-primary" />
                {vol.toLocaleString()} lbs
              </span>
            )}
          </div>
        </div>

        {/* Status + chevron */}
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant={session.status === 'completed' ? 'default' : 'secondary'}
          >
            {session.status}
          </Badge>
          <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </button>

      {/* Delete */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="px-3 py-3.5 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
        aria-label="Delete session"
      >
        ×
      </button>
    </div>
  );
}
