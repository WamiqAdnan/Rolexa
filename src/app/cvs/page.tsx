import { CvLibrary } from "@/components/cv-library";

export const metadata = { title: "CV Library · Rolexa" };

export default function CvsPage() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">CV Library</h1>
        <p className="muted mt-1 max-w-3xl text-sm">
          Keep every version of your CV here — by job title, industry, country or seniority. No
          single CV is treated as the source of truth; the Master Profile is built from all of
          them together.
        </p>
      </header>
      <CvLibrary />
    </div>
  );
}
