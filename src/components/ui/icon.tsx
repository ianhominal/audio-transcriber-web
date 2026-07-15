import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  Cloud,
  CloudOff,
  Copy,
  Download,
  File,
  FileCode,
  FileText,
  FileType,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  Hand,
  Headphones,
  Info,
  Key,
  Languages,
  type LucideIcon,
  Lightbulb,
  Menu,
  Merge,
  MessageSquare,
  Mic,
  Monitor,
  Moon,
  MoreHorizontal,
  PenLine,
  Palette,
  Pencil,
  Plug,
  Plus,
  Search,
  Share,
  SkipForward,
  Sparkles,
  RefreshCw,
  Star,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
  X,
  Zap,
} from "lucide-react";

/**
 * Single source of truth for every product icon (app chrome). We intentionally map by *usage*
 * (`mic`, `delete`, `warning`) rather than by the underlying Lucide component so call sites stay
 * semantic and a future icon swap happens in exactly one place. The app used to render literal
 * emoji (🎙️ 🗑️ ⚠️ …) as icons; those don't inherit color, don't align with text, and render
 * differently per OS. Everything routed through here is a real SVG that inherits `currentColor`
 * and `strokeWidth`, so it themes and aligns consistently.
 *
 * Note: user-picked project icons (the EmojiPicker palette) are user *content*, not chrome, and
 * are deliberately NOT part of this map.
 */
const ICONS = {
  // Navigation / structure
  all: Files,
  folder: Folder,
  "folder-open": FolderOpen,
  "folder-plus": FolderPlus,
  unassigned: File,
  note: FileText,
  back: ArrowLeft,
  "arrow-right": ArrowRight,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  menu: Menu,
  more: MoreHorizontal,
  // Audio / transcription
  mic: Mic,
  audio: AudioLines,
  text: FileText,
  headphones: Headphones,
  capture: Monitor,
  // Actions
  upload: Upload,
  download: Download,
  search: Search,
  edit: Pencil,
  duplicate: Copy,
  delete: Trash2,
  close: X,
  plus: Plus,
  merge: Merge,
  chat: MessageSquare,
  key: Key,
  // AI / features
  sparkles: Sparkles,
  resurface: Lightbulb,
  vocabulary: BookOpen,
  translate: Languages,
  star: Star,
  drive: Cloud,
  // Settings sections
  theme: Palette,
  mcp: Plug,
  // Onboarding
  wave: Hand,
  write: PenLine,
  // Theme toggle
  sun: Sun,
  moon: Moon,
  system: Monitor,
  // Status
  success: CircleCheck,
  error: CircleX,
  warning: TriangleAlert,
  pending: Clock,
  skip: SkipForward,
  check: Check,
  info: Info,
  share: Share,
  // Export formats
  "file-md": FileCode,
  "file-doc": FileType,
  // Marketing / landing
  bolt: Zap,
  sync: RefreshCw,
  offline: CloudOff,
  desktop: Monitor,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

type IconProps = {
  name: IconName;
  /** px size for both width and height. Defaults to 16 (matches `text-sm` line height). */
  size?: number;
  className?: string;
  strokeWidth?: number;
  /**
   * When set, the icon is exposed to assistive tech with this label (role="img").
   * Omit for decorative icons that sit next to a text label (the default: aria-hidden).
   */
  title?: string;
};

/** Semantic icon. `<Icon name="mic" />`. See ICONS for the full vocabulary. */
export function Icon({ name, size = 16, className, strokeWidth = 2, title }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size}
      className={className}
      strokeWidth={strokeWidth}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
    />
  );
}
