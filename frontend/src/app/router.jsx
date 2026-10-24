import { createBrowserRouter, Outlet } from "react-router-dom";
import Backdrop from "../components/Backdrop.jsx";
import { RequireAuth } from "../lib/auth.jsx";
import Dashboard from "../pages/Dashboard.jsx";
import ErrorPage from "../pages/ErrorPage.jsx";
import Explore from "../pages/Explore.jsx";
import Login from "../pages/Login.jsx";
import Shell from "./Shell.jsx";

/** Every route sits under Root, which paints the backdrop once. */
function Root() {
  return (
    <>
      <Backdrop />
      <Outlet />
    </>
  );
}

export const routes = [
  {
    element: <Root />,
    children: [
      { path: "/login", element: <Login /> },
      {
        element: (
          <RequireAuth>
            <Shell />
          </RequireAuth>
        ),
        children: [
          { path: "/", element: <Dashboard />, handle: { title: "Dashboard" } },
          { path: "/events", element: <Explore />, handle: { title: "Explore events" } },
          { path: "/forbidden", element: <ErrorPage code={403} />, handle: { title: "No access" } },
          { path: "*", element: <ErrorPage code={404} />, handle: { title: "Page not found" } },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
