import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  collection, addDoc, getDocs, doc, updateDoc,
  Timestamp, query, orderBy,
} from 'firebase/firestore';
import {
  ref as storageRef, uploadBytes, getDownloadURL,
} from 'firebase/storage';
import { db, storage } from '../firebase';
import {
  CheckSquare, Plus, X, ChevronRight, Calendar,
  Clock, Image as ImageIcon, FileText, Loader2,
  CheckCircle2, Circle, SlidersHorizontal, Upload,
  Trash2, Edit3, Flag,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  score: number;
  note: string;
  date: Timestamp;
  type: 'update' | 'complete' | 'create';
}

interface Task {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  score: number;
  status: 'active' | 'completed';
  createdAt: Timestamp;
  completedAt: Timestamp | null;
  history: HistoryEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (ts: Timestamp) =>
  ts.toDate().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

const formatDateTime = (ts: Timestamp) =>
  ts.toDate().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

const scoreColor = (score: number) => {
  if (score <= 3) return '#059669';
  if (score <= 6) return '#d97706';
  if (score <= 8) return '#7c3aed';
  return '#4f46e5';
};

const scoreLabel = (score: number) => {
  if (score <= 2) return 'Just Started';
  if (score <= 4) return 'In Progress';
  if (score <= 6) return 'Halfway There';
  if (score <= 8) return 'Almost Done';
  return 'Nearly Complete';
};

// ─── Score Slider ─────────────────────────────────────────────────────────────

const ScoreSlider: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => (
  <div className="score-slider-wrap">
    <div className="score-slider-labels">
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
        <button
          key={n}
          className={`score-pip ${n === value ? 'active' : ''}`}
          style={{ '--pip-color': scoreColor(n) } as React.CSSProperties}
          onClick={() => onChange(n)}
          type="button"
          title={`Score ${n}`}
        >
          {n}
        </button>
      ))}
    </div>
    <div className="score-track">
      <div
        className="score-fill"
        style={{ width: `${(value / 10) * 100}%`, background: scoreColor(value) }}
      />
    </div>
  </div>
);

// ─── Progress Bar (read-only) ─────────────────────────────────────────────────

const ProgressBar: React.FC<{ score: number; status: 'active' | 'completed' }> = ({ score, status }) => (
  <div className="task-progress">
    <div className="task-progress-track">
      <div
        className={`task-progress-fill ${status === 'completed' ? 'completed' : ''}`}
        style={{
          width: status === 'completed' ? '100%' : `${(score / 10) * 100}%`,
          background: status === 'completed' ? 'linear-gradient(90deg,#059669,#34d399)' : scoreColor(score),
        }}
      />
    </div>
    <span className="task-progress-label" style={{ color: status === 'completed' ? '#059669' : scoreColor(score) }}>
      {status === 'completed' ? 'Completed \u2713' : `${score}/10`}
    </span>
  </div>
);

// ─── Timeline Entry ───────────────────────────────────────────────────────────

const TimelineEntry: React.FC<{ entry: HistoryEntry; isLast: boolean }> = ({ entry, isLast }) => {
  const icon =
    entry.type === 'complete' ? <CheckCircle2 size={16} color="#059669" /> :
    entry.type === 'create'   ? <Flag size={16} color="#4f46e5" /> :
                                <Edit3 size={16} color="#d97706" />;
  const label =
    entry.type === 'complete' ? 'Task Completed' :
    entry.type === 'create'   ? 'Task Created' :
                                `Score updated to ${entry.score}/10`;

  return (
    <div className={`timeline-entry ${isLast ? 'last' : ''}`}>
      <div className="timeline-dot">{icon}</div>
      <div className="timeline-content">
        <div className="timeline-header">
          <span className="timeline-label">{label}</span>
          {entry.type !== 'complete' && entry.type !== 'create' && (
            <span className="timeline-score-chip" style={{ background: `${scoreColor(entry.score)}20`, color: scoreColor(entry.score) }}>
              {scoreLabel(entry.score)}
            </span>
          )}
        </div>
        {entry.note && <p className="timeline-note">"{entry.note}"</p>}
        <span className="timeline-time">
          <Clock size={12} /> {formatDateTime(entry.date)}
        </span>
      </div>
    </div>
  );
};

// ─── Add Task Modal ───────────────────────────────────────────────────────────

interface AddTaskModalProps {
  onClose: () => void;
  onSave: () => void;
}

const AddTaskModal: React.FC<AddTaskModalProps> = ({ onClose, onSave }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [score, setScore] = useState(1);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImageFile(file);
    if (file) setImagePreview(URL.createObjectURL(file));
    else setImagePreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      let imageUrl: string | null = null;
      if (imageFile) {
        const sRef = storageRef(storage, `tasks/${Date.now()}_${imageFile.name}`);
        await uploadBytes(sRef, imageFile);
        imageUrl = await getDownloadURL(sRef);
      }
      const now = Timestamp.now();
      const firstEntry: HistoryEntry = {
        score,
        note: description.trim(),
        date: now,
        type: 'create',
      };
      await addDoc(collection(db, 'tasks'), {
        title: title.trim(),
        description: description.trim(),
        imageUrl,
        score,
        status: 'active',
        createdAt: now,
        completedAt: null,
        history: [firstEntry],
      });
      onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2><CheckSquare size={22} /> New Task</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Task Title <span className="required">*</span></label>
            <input
              className="form-input"
              placeholder="e.g. Complete project proposal"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Initial Note</label>
            <textarea
              className="form-input form-textarea"
              placeholder="What's the context or starting point for this task?"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Initial Progress Score</label>
            <ScoreSlider value={score} onChange={setScore} />
          </div>

          <div className="form-group">
            <label>Attach Image <span className="optional">(optional)</span></label>
            <div
              className={`image-drop-zone ${imagePreview ? 'has-image' : ''}`}
              onClick={() => fileRef.current?.click()}
            >
              {imagePreview
                ? <img src={imagePreview} alt="preview" className="image-preview-thumb" />
                : (
                  <div className="image-drop-placeholder">
                    <Upload size={28} />
                    <span>Click to upload image</span>
                    <small>PNG, JPG, WEBP up to 10MB</small>
                  </div>
                )
              }
              {imagePreview && (
                <button
                  type="button"
                  className="image-remove-btn"
                  onClick={e => { e.stopPropagation(); setImageFile(null); setImagePreview(null); }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleImage} />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving || !title.trim()}>
              {saving ? <><Loader2 size={16} className="spin" /> Saving&hellip;</> : <><Plus size={16} /> Create Task</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ─── Task Detail Panel ────────────────────────────────────────────────────────

interface TaskDetailProps {
  task: Task;
  onClose: () => void;
  onRefresh: () => void;
}

const TaskDetail: React.FC<TaskDetailProps> = ({ task, onClose, onRefresh }) => {
  const [newScore, setNewScore] = useState(task.score);
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      const entry: HistoryEntry = {
        score: newScore,
        note: newNote.trim(),
        date: Timestamp.now(),
        type: 'update',
      };
      const taskRef = doc(db, 'tasks', task.id);
      await updateDoc(taskRef, {
        score: newScore,
        history: [...task.history, entry],
      });
      setNewNote('');
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!window.confirm('Mark this task as completed?')) return;
    setCompleting(true);
    try {
      const now = Timestamp.now();
      const entry: HistoryEntry = {
        score: 10,
        note: 'Task marked as completed.',
        date: now,
        type: 'complete',
      };
      const taskRef = doc(db, 'tasks', task.id);
      await updateDoc(taskRef, {
        status: 'completed',
        score: 10,
        completedAt: now,
        history: [...task.history, entry],
      });
      onRefresh();
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="detail-header">
          <div>
            <div className="detail-status-badge">
              {task.status === 'completed'
                ? <><CheckCircle2 size={14} color="#059669" /> Completed</>
                : <><Circle size={14} color="#d97706" /> In Progress</>
              }
            </div>
            <h2 className="detail-title">{task.title}</h2>
            <div className="detail-dates">
              <span><Calendar size={13} /> Created {formatDate(task.createdAt)}</span>
              {task.completedAt && (
                <span><CheckCircle2 size={13} /> Done {formatDate(task.completedAt)}</span>
              )}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>

        {/* Image */}
        {task.imageUrl && (
          <div className="detail-image-wrap">
            <img src={task.imageUrl} alt="task" className="detail-image" />
          </div>
        )}

        {/* Progress */}
        <div className="detail-section">
          <ProgressBar score={task.score} status={task.status} />
        </div>

        {/* Timeline */}
        <div className="detail-section">
          <h3 className="detail-section-title"><FileText size={16} /> Progress History</h3>
          <div className="timeline">
            {[...task.history].reverse().map((entry, i) => (
              <TimelineEntry
                key={i}
                entry={entry}
                isLast={i === task.history.length - 1}
              />
            ))}
          </div>
        </div>

        {/* Update form */}
        {task.status === 'active' && (
          <div className="detail-update-form">
            <h3 className="detail-section-title"><SlidersHorizontal size={16} /> Update Progress</h3>
            <form onSubmit={handleUpdate}>
              <div className="form-group">
                <label>New Score</label>
                <ScoreSlider value={newScore} onChange={setNewScore} />
              </div>
              <div className="form-group">
                <label>Note <span className="required">*</span></label>
                <textarea
                  className="form-input form-textarea"
                  placeholder="What did you accomplish? What's next?"
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  rows={3}
                  required
                />
              </div>
              <div className="detail-actions">
                <button type="submit" className="btn-primary" disabled={saving || !newNote.trim()}>
                  {saving ? <><Loader2 size={16} className="spin" /> Saving&hellip;</> : <><Edit3 size={16} /> Submit Update</>}
                </button>
                <button
                  type="button"
                  className="btn-complete"
                  onClick={handleComplete}
                  disabled={completing}
                >
                  {completing ? <><Loader2 size={16} className="spin" /> Completing&hellip;</> : <><CheckCircle2 size={16} /> Mark Complete</>}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Task Card ────────────────────────────────────────────────────────────────

const TaskCard: React.FC<{ task: Task; onClick: () => void }> = ({ task, onClick }) => {
  const lastNote = [...task.history].reverse().find(h => h.note)?.note;

  return (
    <div className={`task-card ${task.status === 'completed' ? 'task-card--completed' : ''}`} onClick={onClick}>
      {task.imageUrl && (
        <div className="task-card-image-wrap">
          <img src={task.imageUrl} alt={task.title} className="task-card-image" />
        </div>
      )}
      <div className="task-card-body">
        <div className="task-card-top">
          <div>
            <div className={`task-status-chip ${task.status}`}>
              {task.status === 'completed' ? <CheckCircle2 size={12} /> : <Circle size={12} />}
              {task.status === 'completed' ? 'Completed' : 'Active'}
            </div>
            <h3 className="task-card-title">{task.title}</h3>
          </div>
          <ChevronRight size={20} className="task-card-arrow" />
        </div>

        <ProgressBar score={task.score} status={task.status} />

        {lastNote && (
          <p className="task-card-note">
            <FileText size={12} />
            <span>"{lastNote}"</span>
          </p>
        )}

        <div className="task-card-footer">
          <span><Calendar size={12} /> {formatDate(task.createdAt)}</span>
          <span>{task.history.length} {task.history.length === 1 ? 'entry' : 'entries'}</span>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export const Tasks: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const data: Task[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Task));
      setTasks(data);
      if (selected) {
        const updated = data.find(t => t.id === selected.id);
        if (updated) setSelected(updated);
      }
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = useCallback(() => {
    fetchTasks();
  }, [fetchTasks]);

  const filtered = tasks.filter(t =>
    filter === 'all' ? true : t.status === filter
  );

  const activeCnt = tasks.filter(t => t.status === 'active').length;
  const doneCnt   = tasks.filter(t => t.status === 'completed').length;

  return (
    <div className="tasks-page">
      {/* Header */}
      <div className="tasks-header">
        <div>
          <h1 className="tasks-title">
            <CheckSquare size={32} className="tasks-title-icon" />
            Tasks
          </h1>
          <p className="tasks-subtitle">Track your progress, step by step</p>
        </div>
        <button className="btn-primary btn-add-task" onClick={() => setShowAdd(true)}>
          <Plus size={18} /> Add Task
        </button>
      </div>

      {/* Stats */}
      <div className="tasks-stats-row">
        <div className="tasks-stat-chip">
          <Circle size={14} color="#d97706" />
          <strong>{activeCnt}</strong> Active
        </div>
        <div className="tasks-stat-chip">
          <CheckCircle2 size={14} color="#059669" />
          <strong>{doneCnt}</strong> Completed
        </div>
        <div className="tasks-stat-chip">
          <CheckSquare size={14} color="#4f46e5" />
          <strong>{tasks.length}</strong> Total
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="tasks-filter-tabs">
        {(['all', 'active', 'completed'] as const).map(f => (
          <button
            key={f}
            className={`filter-tab ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="tasks-loading">
          <Loader2 size={36} className="spin" />
          <p>Loading tasks&hellip;</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="tasks-empty">
          <ImageIcon size={48} opacity={0.3} />
          <h3>No {filter !== 'all' ? filter : ''} tasks yet</h3>
          <p>Click "Add Task" to create your first task.</p>
        </div>
      ) : (
        <div className="tasks-grid">
          {filtered.map(task => (
            <TaskCard key={task.id} task={task} onClick={() => setSelected(task)} />
          ))}
        </div>
      )}

      {/* Modals */}
      {showAdd && (
        <AddTaskModal
          onClose={() => setShowAdd(false)}
          onSave={() => { setShowAdd(false); handleRefresh(); }}
        />
      )}
      {selected && (
        <TaskDetail
          task={selected}
          onClose={() => setSelected(null)}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
};
