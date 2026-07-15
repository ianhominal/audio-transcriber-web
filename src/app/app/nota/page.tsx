import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WriteNoteForm } from "./write-note-form";

/**
 * "Escribir nota": el camino sin micrófono. Nace de un pedido concreto de uso real — a veces no
 * podés (o no querés) grabarte y necesitás tirar la idea escrita, y tiene que quedar EN EL MISMO
 * LUGAR que el resto, no en otra app.
 *
 * `?project=<id>` mantiene el contexto desde el que se llegó (igual que `/app/transcribe`), así la
 * nota cae en el proyecto que la usuaria estaba mirando. El id se re-valida acá (scopeado a
 * `user_id`) solo para poder mostrar el nombre; la validación que IMPORTA — la que decide dónde se
 * guarda — vive en `/api/notes`, que nunca confía en el cliente.
 */
export default async function NotaPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  let projectId: string | null = null;
  let projectName: string | null = null;
  if (project) {
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", project)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string; name: string }>();
    if (data) {
      projectId = data.id;
      projectName = data.name;
    }
  }

  return <WriteNoteForm projectId={projectId} projectName={projectName} />;
}
