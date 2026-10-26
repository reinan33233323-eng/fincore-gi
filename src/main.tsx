import { createRoot } from "react-dom/client";
import "./styles/index.css";

const root = createRoot(document.getElementById("root")!);
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key || url !== "https://ckzivafgsebigxlkqpgn.supabase.co") {
  root.render(
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-8">
      <section className="max-w-lg rounded-2xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold">FinCore Gi — nova instalação</h1>
        <p className="mt-4">A cópia foi preparada. Configure o banco próprio para começar a usar o sistema.</p>
      </section>
    </main>
  );
} else {
  import("./app/App.tsx").then(({ default: App }) => root.render(<App />));
}
