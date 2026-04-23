import Link from 'next/link';
import { appName, appTagline } from '@/lib/shared';

const projects = [
  {
    name: 'Odys',
    description: 'Conversational AI agent with WhatsApp integration, tool calling, and MCP.',
    href: '/docs/projects/odys',
  },
  {
    name: 'Career Chatbot',
    description: 'Retrieval-augmented chatbot built on LangGraph with reranking.',
    href: '/docs/projects/career-chatbot',
  },
  {
    name: 'Inspection API',
    description: 'API service for automated inspection workflows.',
    href: '/docs/projects/inspection-api',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-col flex-1">
      <section className="flex flex-col items-center justify-center text-center px-6 py-24 gap-6">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">{appName}</h1>
        <p className="text-lg text-fd-muted-foreground max-w-xl">{appTagline}</p>
        <Link
          href="/docs"
          className="inline-flex items-center rounded-md border border-fd-border bg-fd-primary text-fd-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90 transition"
        >
          Read the docs
        </Link>
      </section>

      <section className="px-6 pb-24 max-w-5xl mx-auto w-full">
        <h2 className="text-2xl font-semibold mb-6">Projects</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.name}>
              <Link
                href={project.href}
                className="block h-full rounded-lg border border-fd-border p-5 hover:bg-fd-accent hover:text-fd-accent-foreground transition"
              >
                <h3 className="text-lg font-semibold mb-2">{project.name}</h3>
                <p className="text-sm text-fd-muted-foreground">{project.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
