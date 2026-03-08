import { Router, Route } from "@solidjs/router";
import { lazy } from "solid-js";
import Layout from "./components/Layout.js";

const Dashboard = lazy(() => import("./pages/Dashboard.js"));
const Agents = lazy(() => import("./pages/Agents.js"));
const Jobs = lazy(() => import("./pages/Jobs.js"));
const Models = lazy(() => import("./pages/Models.js"));
const ProjectBoard = lazy(() => import("./pages/ProjectBoard.js"));

export default function App() {
  return (
    <Router root={Layout}>
      <Route path="/" component={Dashboard} />
      <Route path="/agents" component={Agents} />
      <Route path="/jobs" component={Jobs} />
      <Route path="/models" component={Models} />
      <Route path="/projects/:id" component={ProjectBoard} />
    </Router>
  );
}
