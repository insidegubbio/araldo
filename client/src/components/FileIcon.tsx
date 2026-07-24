import {
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  FileArchive,
} from "lucide-react";

interface FileIconProps {
  mimeType?: string | null;
  filename?: string;
  className?: string;
}

export function FileIcon({ mimeType, filename, className = "w-5 h-5" }: FileIconProps) {
  const ext = filename?.split(".").pop()?.toLowerCase() ?? "";
  const mime = mimeType ?? "";

  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext))
    return <FileImage className={className} />;
  if (mime.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm"].includes(ext))
    return <FileVideo className={className} />;
  if (mime.startsWith("audio/") || ["mp3", "wav", "flac", "aac", "ogg"].includes(ext))
    return <FileAudio className={className} />;
  if (mime === "application/pdf" || ext === "pdf")
    return <FileText className={className} />;
  if (
    mime.startsWith("text/") ||
    ["txt", "md", "csv", "log"].includes(ext)
  )
    return <FileText className={className} />;
  if (
    ["js", "ts", "tsx", "jsx", "json", "html", "css", "py", "go", "rs", "java", "cpp", "c", "sh"].includes(ext)
  )
    return <FileCode className={className} />;
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext))
    return <FileArchive className={className} />;
  return <File className={className} />;
}
