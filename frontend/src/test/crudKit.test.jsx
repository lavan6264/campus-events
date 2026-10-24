import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Button from "../components/Button.jsx";
import { createResource } from "../lib/crud/createResource.js";
import DataTable from "../lib/crud/DataTable.jsx";
import ResourceForm from "../lib/crud/ResourceForm.jsx";
import { useQueryState } from "../lib/crud/useQueryState.js";
import { installFakeApi, page } from "./fakeApi.js";
import { renderWithProviders } from "./renderApp.jsx";

// A made up resource, to show the kit works for anything: venues with a name and a capacity.
const venues = createResource("venues", { singular: "venue" });

const columns = (actions) => [
  { key: "name", header: "Name", sortable: true },
  { key: "capacity", header: "Capacity", mono: true, sortable: true },
  { key: "actions", header: "Actions", render: (row) => actions(row) },
];

const fields = [
  { name: "name", label: "Name", required: true, maxLength: 40 },
  { name: "capacity", label: "Capacity", type: "number", required: true, min: 1, max: 5000 },
];

function VenuesScreen() {
  const [state, setState] = useQueryState({ sort: "name", limit: "5" });
  const [editing, setEditing] = useStateShim(null);
  const [creating, setCreating] = useStateShim(false);
  const list = venues.useList({ page: state.page, limit: state.limit, sort: state.sort });
  const create = venues.useCreate();
  const update = venues.useUpdate();
  const remove = venues.useRemove();

  return (
    <div>
      <Button onClick={() => setCreating(true)}>New venue</Button>
      {creating ? (
        <ResourceForm
          fields={fields}
          submitLabel="Create venue"
          onCancel={() => setCreating(false)}
          onSubmit={async (payload) => {
            await create.mutateAsync(payload);
            setCreating(false);
          }}
        />
      ) : null}
      {editing ? (
        <ResourceForm
          fields={fields}
          initialValues={editing}
          submitLabel="Save venue"
          onCancel={() => setEditing(null)}
          onSubmit={async (payload) => {
            await update.mutateAsync({ id: editing.id, ...payload });
            setEditing(null);
          }}
        />
      ) : null}
      <DataTable
        columns={columns((row) => (
          <>
            <Button size="sm" onClick={() => setEditing(row)} aria-label={`Edit ${row.name}`}>Edit</Button>
            <Button size="sm" variant="danger" onClick={() => remove.mutate(row.id)} aria-label={`Delete ${row.name}`}>Delete</Button>
          </>
        ))}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.refetch}
        sort={state.sort}
        onSort={(sort) => setState({ sort })}
        onPage={(p) => setState({ page: p })}
        empty={{ title: "No venues yet", text: "Create the first one." }}
      />
    </div>
  );
}

import { useState as useStateShim } from "react";

function fakeVenueServer(initial = []) {
  let rows = [...initial];
  let nextId = rows.length + 1;
  const routes = {
    "GET /venues/": ({ params }) => {
      const sorted = [...rows].sort((a, b) => (a.name > b.name ? 1 : -1));
      return { body: page(sorted, { limit: Number(params.limit || 12), total: sorted.length }) };
    },
    "POST /venues/": ({ body }) => {
      if (rows.some((r) => r.name === body.name)) {
        return { status: 409, body: { error: "Name already in use", fields: { name: "Already in use" } } };
      }
      const row = { id: nextId++, ...body };
      rows.push(row);
      return { status: 201, body: row };
    },
  };
  for (let id = 1; id < 50; id += 1) {
    routes[`PATCH /venues/${id}`] = ({ body }) => {
      rows = rows.map((r) => (r.id === id ? { ...r, ...body } : r));
      return { body: rows.find((r) => r.id === id) };
    };
    routes[`DELETE /venues/${id}`] = () => {
      rows = rows.filter((r) => r.id !== id);
      return { status: 204 };
    };
  }
  return routes;
}

describe("the CRUD kit on a made up resource", () => {
  it("runs a full list, create, edit, delete cycle", async () => {
    const { calls } = installFakeApi(fakeVenueServer([{ id: 1, name: "Seminar Hall", capacity: 80 }]));
    const ui = userEvent.setup();
    renderWithProviders(<VenuesScreen />);

    // list
    expect(await screen.findByText("Seminar Hall")).toBeInTheDocument();

    // create
    await ui.click(screen.getByRole("button", { name: "New venue" }));
    await ui.type(screen.getByLabelText(/^name/i), "Innovation Lab");
    await ui.type(screen.getByLabelText(/^capacity/i), "40");
    await ui.click(screen.getByRole("button", { name: "Create venue" }));
    expect(await screen.findByText("Innovation Lab")).toBeInTheDocument();
    expect(await screen.findByText("Venue created")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST").body).toEqual({ name: "Innovation Lab", capacity: 40 });

    // edit
    await ui.click(screen.getByRole("button", { name: "Edit Innovation Lab" }));
    const name = screen.getByLabelText(/^name/i);
    await ui.clear(name);
    await ui.type(name, "Innovation Studio");
    await ui.click(screen.getByRole("button", { name: "Save venue" }));
    expect(await screen.findByText("Innovation Studio")).toBeInTheDocument();
    expect(screen.queryByText("Innovation Lab")).not.toBeInTheDocument();
    expect(calls.find((c) => c.method === "PATCH").body).toEqual({ name: "Innovation Studio", capacity: 40 });

    // delete
    await ui.click(screen.getByRole("button", { name: "Delete Innovation Studio" }));
    await waitFor(() => expect(screen.queryByText("Innovation Studio")).not.toBeInTheDocument());
    expect(await screen.findByText("Venue deleted")).toBeInTheDocument();
    expect(screen.getByText("Seminar Hall")).toBeInTheDocument();
  });

  it("maps a server field error onto the input and keeps the form open", async () => {
    installFakeApi(fakeVenueServer([{ id: 1, name: "Seminar Hall", capacity: 80 }]));
    const ui = userEvent.setup();
    renderWithProviders(<VenuesScreen />);
    await screen.findByText("Seminar Hall");

    await ui.click(screen.getByRole("button", { name: "New venue" }));
    await ui.type(screen.getByLabelText(/^name/i), "Seminar Hall");
    await ui.type(screen.getByLabelText(/^capacity/i), "10");
    await ui.click(screen.getByRole("button", { name: "Create venue" }));

    const input = await screen.findByLabelText(/^name/i);
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText("Already in use")).toBeInTheDocument();
    expect(screen.queryByText(/venue created/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create venue" })).toBeEnabled();

    // Typing clears the server message for that field.
    await ui.type(input, " 2");
    expect(screen.queryByText("Already in use")).not.toBeInTheDocument();
  });

  it("blocks bad input before any request, using the same rules as the server", async () => {
    const { calls } = installFakeApi(fakeVenueServer());
    const ui = userEvent.setup();
    renderWithProviders(<VenuesScreen />);
    await screen.findByText("No venues yet");

    await ui.click(screen.getByRole("button", { name: "New venue" }));
    await ui.type(screen.getByLabelText(/^capacity/i), "0");
    await ui.click(screen.getByRole("button", { name: "Create venue" }));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("Must be at least 1")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("disables submit while saving", async () => {
    let release;
    installFakeApi({
      ...fakeVenueServer(),
      "POST /venues/": () => new Promise((resolve) => { release = () => resolve({ status: 201, body: { id: 1, name: "X", capacity: 1 } }); }),
    });
    const ui = userEvent.setup();
    renderWithProviders(<VenuesScreen />);
    await screen.findByText("No venues yet");
    await ui.click(screen.getByRole("button", { name: "New venue" }));
    await ui.type(screen.getByLabelText(/^name/i), "X");
    await ui.type(screen.getByLabelText(/^capacity/i), "1");
    await ui.click(screen.getByRole("button", { name: "Create venue" }));

    const saving = await screen.findByRole("button", { name: "Saving" });
    expect(saving).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Saving" })).not.toBeInTheDocument());
  });
});

describe("DataTable states", () => {
  const cols = [{ key: "name", header: "Name", sortable: true }, { key: "capacity", header: "Capacity" }];

  it("shows skeleton rows while loading, not a spinner", () => {
    const { container } = renderWithProviders(<DataTable columns={cols} isLoading />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(6);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows an empty state with a next step", () => {
    renderWithProviders(
      <DataTable columns={cols} data={page([])} empty={{ title: "No events match", text: "Clear filters or try a different date.", action: <Button>Clear filters</Button> }} />,
    );
    expect(screen.getByRole("heading", { name: "No events match" })).toBeInTheDocument();
    expect(screen.getByText("Clear filters or try a different date.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("shows an error with a retry", async () => {
    const retry = vi.fn();
    renderWithProviders(<DataTable columns={cols} error={{ message: "Cannot reach the server." }} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Cannot reach the server.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("sorts from the header and reports sort state to assistive tech", async () => {
    const onSort = vi.fn();
    const data = page([{ id: 1, name: "A", capacity: 1 }]);
    const { rerender } = renderWithProviders(<DataTable columns={cols} data={data} sort="name" onSort={onSort} />);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith("-name");
    rerender(<DataTable columns={cols} data={data} sort="-name" onSort={onSort} />);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("labels every cell for the stacked mobile layout and pages through results", async () => {
    const onPage = vi.fn();
    const data = page([{ id: 1, name: "Seminar Hall", capacity: 80 }], { page: 2, pages: 3, total: 25, limit: 12 });
    const { container } = renderWithProviders(<DataTable columns={cols} data={data} onPage={onPage} noun="venues" />);
    const cells = container.querySelectorAll("tbody td");
    expect([...cells].map((c) => c.getAttribute("data-label"))).toEqual(["Name", "Capacity"]);
    expect(screen.getByText(/of/, { selector: "p" })).toHaveTextContent("13 to 24 of 25 venues");
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(3);
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  });
});

describe("useQueryState", () => {
  function Probe() {
    const [state, setState, clear] = useQueryState({ sort: "start_time", limit: "12" });
    return (
      <div>
        <p data-testid="state">{JSON.stringify(state)}</p>
        <p data-testid="url">{window.location.search}</p>
        <button onClick={() => setState({ page: 3 })}>page 3</button>
        <button onClick={() => setState({ category: "Workshop" })}>filter</button>
        <button onClick={() => setState({ sort: "start_time" })}>default sort</button>
        <button onClick={() => clear()}>clear</button>
      </div>
    );
  }

  it("reads defaults, resets the page when a filter changes, and clears", async () => {
    const ui = userEvent.setup();
    renderWithProviders(<Probe />, { url: "/events?page=2&category=Sports" });
    const read = () => JSON.parse(screen.getByTestId("state").textContent);

    expect(read()).toEqual({ sort: "start_time", limit: "12", page: 2, category: "Sports" });
    await ui.click(screen.getByRole("button", { name: "filter" }));
    expect(read()).toEqual({ sort: "start_time", limit: "12", page: 1, category: "Workshop" });
    await ui.click(screen.getByRole("button", { name: "page 3" }));
    expect(read().page).toBe(3);
    expect(read().category).toBe("Workshop");
    await ui.click(screen.getByRole("button", { name: "clear" }));
    expect(read()).toEqual({ sort: "start_time", limit: "12", page: 1 });
  });
});

describe("a single row in a table", () => {
  it("renders custom cells", () => {
    const data = page([{ id: 1, name: "Hall", capacity: 5 }]);
    renderWithProviders(<DataTable columns={[{ key: "name", header: "Name", render: (r) => <b>{r.name.toUpperCase()}</b> }]} data={data} />);
    expect(within(screen.getByRole("table")).getByText("HALL")).toBeInTheDocument();
  });
});
