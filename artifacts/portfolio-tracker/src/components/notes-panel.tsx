import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Pin, PinOff, Trash2, Plus, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface Note {
  id: number;
  portfolioId: number | null;
  holdingId: number | null;
  title: string | null;
  content: string;
  isPinned: boolean;
  color: string;
  createdAt: string;
  updatedAt: string;
  portfolioName?: string | null;
  holdingSymbol?: string | null;
}

const NOTE_COLORS = [
  { id: "default", label: "Default", bg: "bg-card",       border: "border-border"          },
  { id: "blue",    label: "Blue",    bg: "bg-blue-950/40", border: "border-blue-700/50"     },
  { id: "green",   label: "Green",   bg: "bg-green-950/40",border: "border-green-700/50"    },
  { id: "amber",   label: "Amber",   bg: "bg-amber-950/40",border: "border-amber-700/50"    },
  { id: "red",     label: "Red",     bg: "bg-red-950/40",  border: "border-red-700/50"      },
  { id: "purple",  label: "Purple",  bg: "bg-purple-950/40",border: "border-purple-700/50"  },
];

function colorStyle(color: string) {
  return NOTE_COLORS.find(c => c.id === color) ?? NOTE_COLORS[0];
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, { credentials: "include", ...opts });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

interface NotesPanelProps {
  portfolioId?: number;
  holdingId?: number;
}

export function NotesPanel({ portfolioId, holdingId }: NotesPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const queryKey = ["notes", portfolioId, holdingId];
  const params = new URLSearchParams();
  if (holdingId) params.set("holdingId", String(holdingId));
  else if (portfolioId) params.set("portfolioId", String(portfolioId));

  const { data: notes, isLoading } = useQuery<Note[]>({
    queryKey,
    queryFn: () => apiFetch(`/api/notes?${params}`),
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const createMutation = useMutation({
    mutationFn: (body: object) => apiFetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { invalidate(); setComposing(false); toast({ title: "Note added" }); },
    onError: () => toast({ title: "Failed to add note", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & object) =>
      apiFetch(`/api/notes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { invalidate(); setEditingId(null); },
    onError: () => toast({ title: "Failed to update note", variant: "destructive" }),
  });

  const pinMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/notes/${id}/pin`, { method: "PATCH" }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/notes/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Note deleted" }); },
    onError: () => toast({ title: "Failed to delete note", variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-3">
      {/* Compose button / form */}
      {!composing ? (
        <Button variant="outline" size="sm" className="gap-1.5 w-full" onClick={() => setComposing(true)}>
          <Plus className="w-3.5 h-3.5" /> Add Note
        </Button>
      ) : (
        <ComposeForm
          onSave={(data) => createMutation.mutate({ portfolioId, holdingId, ...data })}
          onCancel={() => setComposing(false)}
          saving={createMutation.isPending}
        />
      )}

      {/* Notes list */}
      {notes?.length === 0 && !composing && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No notes yet. Click "Add Note" to record your investment thesis, reminders, or key observations.
        </p>
      )}

      <div className="space-y-3">
        {notes?.map(note => (
          editingId === note.id ? (
            <ComposeForm
              key={note.id}
              initial={note}
              onSave={(data) => updateMutation.mutate({ id: note.id, ...data })}
              onCancel={() => setEditingId(null)}
              saving={updateMutation.isPending}
            />
          ) : (
            <NoteCard
              key={note.id}
              note={note}
              onPin={() => pinMutation.mutate(note.id)}
              onEdit={() => setEditingId(note.id)}
              onDelete={() => deleteMutation.mutate(note.id)}
              deleting={deleteMutation.isPending}
            />
          )
        ))}
      </div>
    </div>
  );
}

interface ComposeFormProps {
  initial?: Note;
  onSave: (data: { title: string | null; content: string; color: string }) => void;
  onCancel: () => void;
  saving: boolean;
}

function ComposeForm({ initial, onSave, onCancel, saving }: ComposeFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [color, setColor] = useState(initial?.color ?? "default");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const handleSave = () => {
    if (!content.trim()) return;
    onSave({ title: title.trim() || null, content: content.trim(), color });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
    if (e.key === "Escape") onCancel();
  };

  const c = colorStyle(color);

  return (
    <div className={cn("rounded-lg border p-4 space-y-3 transition-colors", c.bg, c.border)}>
      <Input
        placeholder="Title (optional)"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="h-8 text-sm bg-transparent border-transparent px-0 focus-visible:ring-0 font-medium placeholder:text-muted-foreground/60"
      />
      <Textarea
        ref={textareaRef}
        placeholder="Write your note... (Ctrl+Enter to save)"
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={4}
        className="resize-none bg-transparent border-transparent px-0 focus-visible:ring-0 text-sm placeholder:text-muted-foreground/60 leading-relaxed"
      />
      <div className="flex items-center justify-between pt-1">
        {/* Color picker */}
        <div className="flex gap-1.5">
          {NOTE_COLORS.map(c => (
            <button
              key={c.id}
              onClick={() => setColor(c.id)}
              title={c.label}
              className={cn(
                "w-4 h-4 rounded-full border-2 transition-all",
                c.id === "default" ? "bg-slate-500" :
                c.id === "blue"    ? "bg-blue-500" :
                c.id === "green"   ? "bg-green-500" :
                c.id === "amber"   ? "bg-amber-500" :
                c.id === "red"     ? "bg-red-500" :
                "bg-purple-500",
                color === c.id ? "border-white scale-110" : "border-transparent opacity-60"
              )}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 px-2 gap-1 text-xs">
            <X className="w-3 h-3" /> Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!content.trim() || saving} className="h-7 px-3 gap-1 text-xs">
            <Check className="w-3 h-3" /> {saving ? "Saving..." : initial ? "Update" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface NoteCardProps {
  note: Note;
  onPin: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}

function NoteCard({ note, onPin, onEdit, onDelete, deleting }: NoteCardProps) {
  const c = colorStyle(note.color);
  const timeAgo = formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true });

  return (
    <div className={cn("group rounded-lg border p-4 transition-colors hover:opacity-95", c.bg, c.border, note.isPinned && "ring-1 ring-primary/30")}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          {note.isPinned && (
            <span className="inline-flex items-center gap-1 text-xs text-primary font-medium mb-1">
              <Pin className="w-3 h-3" /> Pinned
            </span>
          )}
          {note.title && (
            <h4 className="font-semibold text-sm leading-tight truncate">{note.title}</h4>
          )}
        </div>
        {/* Actions — shown on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={onPin}
            title={note.isPinned ? "Unpin" : "Pin"}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {note.isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onEdit}
            title="Edit"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            title="Delete"
            className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-muted transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">{note.content}</p>

      <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/50">
        <span className="text-xs text-muted-foreground">{timeAgo}</span>
        {note.portfolioName && !note.holdingSymbol && (
          <span className="text-xs text-muted-foreground">• {note.portfolioName}</span>
        )}
        {note.holdingSymbol && (
          <span className="text-xs text-muted-foreground">• {note.holdingSymbol}</span>
        )}
      </div>
    </div>
  );
}
