import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { LayoutDashboard, LogOut, Settings as SettingsIcon } from "lucide-react";
import { lazy, StrictMode, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile, useVisualViewport } from "@/hooks/use-mobile";
import { api, ApiError, unwrap } from "@/lib/api";
import { useUpdateStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";
import Dashboard from "@/routes/Dashboard";
import Login from "@/routes/Login";
import Settings from "@/routes/Settings";
import Setup from "@/routes/Setup";
import "./index.css";

// Terminal + editor code is only needed on project pages.
const ProjectPage = lazy(() => import("@/routes/ProjectPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

function Shell() {
  const location = useLocation();
  const inProject = location.pathname.startsWith("/p/");
  const update = useUpdateStatus();
  const nav = (to: string, label: string, Icon: typeof LayoutDashboard, dot = false) => (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          "flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm",
          isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
        )
      }
    >
      <span className="relative">
        <Icon className="size-4" />
        {dot && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </NavLink>
  );

  return (
    <div className="flex h-full flex-col">
      {!inProject && (
        <header className="flex shrink-0 items-center gap-1 border-b px-3 py-2 pt-safe-2 sm:gap-2 sm:px-6 sm:py-2.5 sm:pt-safe-2.5">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="mr-2 font-semibold sm:mr-4">Project Hub</span>
          {nav("/", "Dashboard", LayoutDashboard)}
          {nav("/settings", "Settings", SettingsIcon, update.data?.available)}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-9 text-muted-foreground"
            onClick={async () => {
              await api.auth.logout.post();
              queryClient.clear();
              window.location.href = "/";
            }}
          >
            <LogOut /> <span className="hidden sm:inline">Log out</span>
          </Button>
        </header>
      )}
      <main className={cn("min-h-0 flex-1", inProject ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden")}>
        <Suspense fallback={null}>
            <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
          <Route path="/p/:project" element={<ProjectPage />} />
          <Route path="*" element={<div className="p-8 text-muted-foreground">Page not found.</div>} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

function App() {
  useVisualViewport();
  const me = useQuery({ queryKey: ["me"], queryFn: () => unwrap(api.auth.me.get()), staleTime: Infinity });

  useEffect(() => {
    const on = () => queryClient.setQueryData(["me"], { authed: false, needsSetup: false });
    window.addEventListener("hub:unauthorized", on);
    return () => window.removeEventListener("hub:unauthorized", on);
  }, []);

  if (me.isLoading) return null;
  const reload = () => me.refetch().then(() => queryClient.invalidateQueries());
  if (me.data?.needsSetup) return <Setup onDone={reload} />;
  if (!me.data?.authed) return <Login onLoggedIn={reload} />;
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}

function Toasts() {
  const isMobile = useIsMobile();
  return <Toaster position={isMobile ? "top-center" : "bottom-right"} richColors closeButton={!isMobile} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <App />
        <Toasts />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
