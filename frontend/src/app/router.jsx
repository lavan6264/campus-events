import { createBrowserRouter, Outlet } from "react-router-dom";
import Backdrop from "../components/Backdrop.jsx";
import { RequireAuth } from "../lib/auth.jsx";
import Dashboard from "../pages/Dashboard.jsx";
import ErrorPage from "../pages/ErrorPage.jsx";
import EventDetail from "../pages/EventDetail.jsx";
import EventForm from "../pages/EventForm.jsx";
import Explore from "../pages/Explore.jsx";
import Login from "../pages/Login.jsx";
import MyEvents from "../pages/MyEvents.jsx";
import Participants from "../pages/Participants.jsx";
import Reports from "../pages/Reports.jsx";
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
          {
            path: "/events/new",
            element: (
              <RequireAuth roles={["faculty", "admin"]}>
                <EventForm mode="create" />
              </RequireAuth>
            ),
            handle: { title: "Create event" },
          },
          { path: "/events/:id", element: <EventDetail />, handle: { title: "Event" } },
          {
            path: "/events/:id/edit",
            element: (
              <RequireAuth roles={["faculty", "admin"]}>
                <EventForm mode="edit" />
              </RequireAuth>
            ),
            handle: { title: "Edit event" },
          },
          {
            path: "/events/:id/participants",
            element: (
              <RequireAuth roles={["faculty", "admin"]}>
                <Participants />
              </RequireAuth>
            ),
            handle: { title: "Participants" },
          },
          {
            path: "/my-events",
            element: (
              <RequireAuth roles={["faculty", "admin"]}>
                <MyEvents />
              </RequireAuth>
            ),
            handle: { title: "My events" },
          },
          {
            path: "/reports",
            element: (
              <RequireAuth roles={["admin"]}>
                <Reports />
              </RequireAuth>
            ),
            handle: { title: "Reports" },
          },
          { path: "/forbidden", element: <ErrorPage code={403} />, handle: { title: "No access" } },
          { path: "*", element: <ErrorPage code={404} />, handle: { title: "Page not found" } },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
