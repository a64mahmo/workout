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
  const [newExercise, setNewExercise] = useState({ name: '', muscle_group: '', description: '' });
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
      setNewExercise({ name: '', muscle_group: '', description: '' });
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
    console.log('handleCreate called for exercise with:', newExercise);
    if (newExercise.name && newExercise.muscle_group) {
      createMutation.mutate(newExercise);
    } else {
      alert('Please fill in Name and Muscle Group');
    }
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(exercise.id)}
                  >
                    Delete
                  </Button>
                </div>
                {exercise.description && (
                  <p className="text-sm text-muted-foreground mt-2">{exercise.description}</p>
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
