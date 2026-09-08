export interface CommentAuthor {
  name: string;
  avatar?: string;
}

export interface CommentReply {
  id: string;
  author: CommentAuthor;
  content: string;
  createdAt: number;
}

export interface NoteComment {
  id: string;
  notePath: string;
  from: number;
  to: number;
  selectedText: string;
  content: string;
  author: CommentAuthor;
  createdAt: number;
  resolved?: boolean;
  replies?: CommentReply[];
}

export interface PendingComment {
  id: string;
  from: number;
  to: number;
  selectedText: string;
  targetTop: number;
}
