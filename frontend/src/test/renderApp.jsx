import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { ToastProvider } from "../components/Toast.jsx";
import { routes } from "../app/router.jsx";
import { AuthProvider } from "../lib/auth.jsx";

export const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });

/** The whole app, at a given URL. */
export function renderApp(url = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const client = newClient();
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...view, router, client };
}

/** A single component with the providers it needs. */
export function renderWithProviders(ui, { url = "/" } = {}) {
  const client = newClient();
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    ),
  };
}
