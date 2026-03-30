'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { Exercise } from '@/types';
import { Pencil } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const muscleGroups = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'cardio'];

export default function ExercisesPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newExercise, setNewExercise] = useState({ name: '', muscle_group: '', category: 'weighted', description: '' });
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [editFields, setEditFields] = useState({ name: '', muscle_group: '', category: 'weighted', description: '' });
  const queryClient = useQueryClient();

  const { data: exercises, isLoading } = useQuery({
    queryKey: ['exercises', filter],
    queryFn: async () => {
      const url = filter ? `/api/exercises?muscle_group=${filter}` : '/api/exercises';
      const res = await api.get(url);
      return res.data as Exercise[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newExercise) => {
      const res = await api.post('/api/exercises', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
      setIsDialogOpen(false);
      setNewExercise({ name: '', muscle_group: '', category: 'weighted', description: '' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof editFields) => {
      const res = await api.put(`/api/exercises/${editingExercise!.id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
      setEditingExercise(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/exercises/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
    },
  });

  const filteredExercises = exercises?.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleCreate = () => {
    if (newExercise.name && newExercise.muscle_group) {
      createMutation.mutate(newExercise);
    } else {
      alert('Please fill in Name and Muscle Group');
    }
  };

  const openEdit = (exercise: Exercise) => {
    setEditingExercise(exercise);
    setEditFields({
      name: exercise.name,
      muscle_group: exercise.muscle_group,
      category: exercise.category ?? 'weighted',
      description: exercise.description ?? '',
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Exercises</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger render={<Button>Add Exercise</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Exercise</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Exercise name"
                value={newExercise.name}
                onChange={(e) => setNewExercise({ ...newExercise, name: e.target.value })}
              />
              <Select
                value={newExercise.muscle_group}
                onValueChange={(value) => value && setNewExercise({ ...newExercise, muscle_group: value })}
              >
                <SelectTrigger className="w-full h-10">
                  <SelectValue placeholder="Select muscle group" />
                </SelectTrigger>
                <SelectContent>
                  {muscleGroups.map(group => (
                    <SelectItem key={group} value={group}>{group}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={newExercise.category}
                onValueChange={(value) => value && setNewExercise({ ...newExercise, category: value })}
              >
                <SelectTrigger className="w-full h-10">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weighted">Weighted</SelectItem>
                  <SelectItem value="bodyweight">Bodyweight</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Description (optional)"
                value={newExercise.description}
                onChange={(e) => setNewExercise({ ...newExercise, description: e.target.value })}
              />
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-4">
        <Input
          placeholder="Search exercises..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={filter}
          onValueChange={(value) => value && setFilter(value)}
        >
          <SelectTrigger className="w-[200px] h-10">
            <SelectValue placeholder="All muscle groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All muscle groups</SelectItem>
            {muscleGroups.map(group => (
              <SelectItem key={group} value={group}>{group}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingExercise} onOpenChange={open => { if (!open) setEditingExercise(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Exercise</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Exercise name"
              value={editFields.name}
              onChange={e => setEditFields(f => ({ ...f, name: e.target.value }))}
              autoFocus
            />
            <Select
              value={editFields.muscle_group}
              onValueChange={value => value && setEditFields(f => ({ ...f, muscle_group: value }))}
            >
              <SelectTrigger className="w-full h-10">
                <SelectValue placeholder="Select muscle group" />
              </SelectTrigger>
              <SelectContent>
                {muscleGroups.map(group => (
                  <SelectItem key={group} value={group}>{group}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={editFields.category}
              onValueChange={value => value && setEditFields(f => ({ ...f, category: value }))}
            >
              <SelectTrigger className="w-full h-10">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weighted">Weighted</SelectItem>
                <SelectItem value="bodyweight">Bodyweight</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Description (optional)"
              value={editFields.description}
              onChange={e => setEditFields(f => ({ ...f, description: e.target.value }))}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditingExercise(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => updateMutation.mutate(editFields)}
                disabled={!editFields.name || !editFields.muscle_group || updateMutation.isPending}
              >
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <p>Loading...</p>
      ) : filteredExercises.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-3">
          {filteredExercises.map(exercise => (
            <Card key={exercise.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">{exercise.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center">
                  <Badge>{exercise.muscle_group}</Badge>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(exercise)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(exercise.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                {exercise.description && (
                  <p className="text-sm text-muted-foreground mt-2">{exercise.description}</p>
                )}
                {exercise.category && exercise.category !== 'weighted' && (
                  <p className="text-xs text-muted-foreground mt-1 capitalize">{exercise.category}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">No exercises found</p>
      )}
    </div>
  );
}
