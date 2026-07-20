import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
} from "react-router-dom";
import "./styles.css";
import { AuthProvider, useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Projects } from "./pages/Projects";
import { ProjectPage } from "./pages/Project";
import { EntityPage } from "./pages/Entity";
import { PostEditorPage } from "./pages/PostEditor";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthed } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Projects /> },
      { path: "projects/:projectId", element: <ProjectPage /> },
      { path: "projects/:projectId/entities/:entityId", element: <EntityPage /> },
      { path: "projects/:projectId/posts/:postId", element: <PostEditorPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
