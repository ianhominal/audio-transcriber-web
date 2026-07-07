"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export default function LogoutButton() {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await supabase.auth.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      Salir
    </Button>
  );
}
