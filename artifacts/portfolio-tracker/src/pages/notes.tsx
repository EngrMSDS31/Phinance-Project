import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Pin, PinOff, Trash2, Pencil, Plus, Check, X, StickyNote, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useListPortfolios } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Note } from "@/components/notes-panel";

const NOTE_COLORS = [
  { id: "default", bg: "bg-card",        border: "border-border"         },
  { id: "blue",    bg: "bg-blue-950/40", border: "border-blue-700/50"    },
  { id: "green",   bg: "bg-green-950/40",border: "border-green-700/50"   },
  { id: "amber",   bg: "bg-amber-950/40",border: "border-amber-700/50"   },
  { id: "red",     bg: "bg-red-950/40",  border: "border-red-700/50"     },
  { id: "purple",  bg: "bg-purple-950/40",border: "border-purple-700/50" },
];

function colorStyle(color: string) {
  return NOTE_COLORS.find(c => c.id === color) ?? NOTE_COLORS[0];
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, { credentials: "include", ...opts });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export default function NotesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterPortfolio, setFilterPortfolio] = useState("all");
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: portfolios } = useListPortfolios();

  const params = new URLSearchParams();
  if (filterPortfolio !== "all") params.set("portfolioId", filterPortfolio);

  const queryKey = ["notes", "all", filterPortfolio];
  const { data: notes, isLoading } = useQuery<Note[]>({
    queryKey,
    queryFn: () => apiFetch(`/api/notes?${params}`),
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notes"] });

  const createMutation = useMutation({
    mutationFn: (body: object) => apiFetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { invalidate(); setComposing(false); toast({ title: "Note added" }); },
    onError: () => toast({ title: "Failed to add note", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & object) =>
      apiFetch(`/api/notes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { invalidate(); setEditingId(null); },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const pinMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/notes/${id}/pin`, { method: "PATCH" }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/notes/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast({ title: "Note deleted" }); },
  });

  const filtered = notes?.filter(n => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (n.title?.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.holdingSymbol?.toLowerCase().includes(q));
  }) ?? [];

  const pinned = filtered.filter(n => n.isPinned);
  const unpinned = filtered.filter(n => !n.isPinned);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notes</h1>
          <p className="text-muted-foreground text-sm mt-1">Annotate your portfolios and holdings with timestamped notes</p>
        </div>
        <Button onClick={() => setComposing(true)} className="gap-1.5 sm:w-auto w-full" disabled={composing}>
          <Plus className="w-4 h-4" /> New Note
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search notes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterPortfolio} onValueChange={setFilterPortfolio}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="All Portfolios" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Portfolios</SelectItem>
            {portfolios?.map(p => (
              <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Compose form */}
      {composing && (
        <GlobalComposeForm
          portfolios={portfolios ?? []}
          onSave={(data) => createMutation.mutate(data)}
          onCancel={() => setComposing(false)}
          saving={createMutation.isPending}
        />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && !composing && (
        <div className="rounded-lg border border-border bg-card flex flex-col items-center justify-center py-20 gap-4">
          <StickyNote className="w-12 h-12 text-muted-foreground/40" />
          <div className="text-center">
            <p className="text-lg font-medium">No notes yet</p>
            <p className="text-sm text-muted-foreground mt-1">Start by clicking "New Note" to record your investment thesis, reminders, or key observations.</p>
          </div>
          <Button variant="outline" onClick={() => setComposing(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> Write your first note
          </Button>
        </div>
      )}

      {/* Pinned notes */}
      {pinned.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Pin className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-primary uppercase tracking-wider">Pinned</span>
          </div>
          <NoteGrid>
            {pinned.map(note => (
              editingId === note.id
                ? <InlineEdit key={note.id} note={note} portfolios={portfolios ?? []} onSave={(data) => updateMutation.mutate({ id: note.id, ...data })} onCancel={() => setEditingId(null)} saving={updateMutation.isPending} />
                : <NoteCard key={note.id} note={note} onPin={() => pinMutation.mutate(note.id)} onEdit={() => setEditingId(note.id)} onDelete={() => deleteMutation.mutate(note.id)} />
            ))}
          </NoteGrid>
        </div>
      )}

      {/* All notes */}
      {unpinned.length > 0 && (
        <div className="space-y-3">
          {pinned.length > 0 && (
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">All Notes</span>
          )}
          <NoteGrid>
            {unpinned.map(note => (
              editingId === note.id
                ? <InlineEdit key={note.id} note={note} portfolios={portfolios ?? []} onSave={(data) => updateMutation.mutate({ id: note.id, ...data })} onCancel={() => setEditingId(null)} saving={updateMutation.isPending} />
                : <NoteCard key={note.id} note={note} onPin={() => pinMutation.mutate(note.id)} onEdit={() => setEditingId(note.id)} onDelete={() => deleteMutation.mutate(note.id)} />
            ))}
          </NoteGrid>
        </div>
      )}
    </div>
  );
}

function NoteGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>;
}

interface NoteCardProps {
  note: Note;
  onPin: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function NoteCard({ note, onPin, onEdit, onDelete }: NoteCardProps) {
  const c = colorStyle(note.color);
  const timeAgo = formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true });

  return (
    <div className={cn("group rounded-lg border p-4 flex flex-col gap-3 transition-all hover:shadow-md", c.bg, c.border, note.isPinned && "ring-1 ring-primary/40")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {note.title && <h4 className="font-semibold text-sm leading-snug break-words">{note.title}</h4>}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={onPin} title={note.isPinned ? "Unpin" : "Pin"} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            {note.isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onEdit} title="Edit" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} title="Delete" className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-muted transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap break-words flex-1 line-clamp-6">{note.content}</p>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
        {note.portfolioName && (
          <Badge variant="outline" className="text-xs">{note.portfolioName}</Badge>
        )}
        {note.holdingSymbol && (
          <Badge variant="secondary" className="text-xs font-mono">{note.holdingSymbol}</Badge>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{timeAgo}</span>
      </div>
    </div>
  );
}

interface GlobalComposeFormProps {
  portfolios: Array<{ id: number; name: string }>;
  onSave: (data: object) => void;
  onCancel: () => void;
  saving: boolean;
}

function GlobalComposeForm({ portfolios, onSave, onCancel, saving }: GlobalComposeFormProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [color, setColor] = useState("default");
  const [portfolioId, setPortfolioId] = useState<string>("none");

  return (
    <div className={cn("rounded-lg border p-5 space-y-4", colorStyle(color).bg, colorStyle(color).border)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">New Note</span>
        <div className="flex gap-1.5">
          {NOTE_COLORS.map(c => (
            <button key={c.id} onClick={() => setColor(c.id)} className={cn(
              "w-4 h-4 rounded-full border-2 transition-all",
              c.id === "default" ? "bg-slate-500" : c.id === "blue" ? "bg-blue-500" : c.id === "green" ? "bg-green-500" : c.id === "amber" ? "bg-amber-500" : c.id === "red" ? "bg-red-500" : "bg-purple-500",
              color === c.id ? "border-white scale-110" : "border-transparent opacity-50"
            )} />
          ))}
        </div>
      </div>

      <Select value={portfolioId} onValueChange={setPortfolioId}>
        <SelectTrigger className="h-8 text-sm bg-transparent">
          <SelectValue placeholder="Attach to portfolio (optional)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No portfolio</SelectItem>
          {portfolios.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>

      <Input
        placeholder="Title (optional)"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="h-9 bg-transparent border-border/60 text-sm"
      />

      <Textarea
        placeholder="Write your note... (Ctrl+Enter to save)"
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && content.trim()) onSave({ title: title.trim() || null, content: content.trim(), color, portfolioId: portfolioId !== "none" ? parseInt(portfolioId) : null }); if (e.key === "Escape") onCancel(); }}
        rows={5}
        autoFocus
        className="resize-none bg-transparent text-sm leading-relaxed"
      />

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1 h-8">
          <X className="w-3.5 h-3.5" /> Cancel
        </Button>
        <Button size="sm" disabled={!content.trim() || saving} className="gap-1 h-8"
          onClick={() => onSave({ title: title.trim() || null, content: content.trim(), color, portfolioId: portfolioId !== "none" ? parseInt(portfolioId) : null })}>
          <Check className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Save Note"}
        </Button>
      </div>
    </div>
  );
}

interface InlineEditProps {
  note: Note;
  portfolios: Array<{ id: number; name: string }>;
  onSave: (data: object) => void;
  onCancel: () => void;
  saving: boolean;
}

function InlineEdit({ note, portfolios, onSave, onCancel, saving }: InlineEditProps) {
  const [title, setTitle] = useState(note.title ?? "");
  const [content, setContent] = useState(note.content);
  const [color, setColor] = useState(note.color);

  return (
    <div className={cn("rounded-lg border p-4 space-y-3 col-span-1", colorStyle(color).bg, colorStyle(color).border)}>
      <div className="flex gap-1.5">
        {NOTE_COLORS.map(c => (
          <button key={c.id} onClick={() => setColor(c.id)} className={cn(
            "w-4 h-4 rounded-full border-2 transition-all",
            c.id === "default" ? "bg-slate-500" : c.id === "blue" ? "bg-blue-500" : c.id === "green" ? "bg-green-500" : c.id === "amber" ? "bg-amber-500" : c.id === "red" ? "bg-red-500" : "bg-purple-500",
            color === c.id ? "border-white scale-110" : "border-transparent opacity-50"
          )} />
        ))}
      </div>
      <Input placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} className="h-8 bg-transparent border-border/60 text-sm" />
      <Textarea value={content} onChange={e => setContent(e.target.value)} rows={4} autoFocus className="resize-none bg-transparent text-sm leading-relaxed" />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1 h-8"><X className="w-3.5 h-3.5" /> Cancel</Button>
        <Button size="sm" disabled={!content.trim() || saving} className="gap-1 h-8" onClick={() => onSave({ title: title.trim() || null, content, color })}>
          <Check className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Update"}
        </Button>
      </div>
    </div>
  );
}
