import { JobsScreen } from "@/components/jobs-screen";

export const metadata = { title: "Jobs · Rolexa" };

export default function JobsPage() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Jobs</h1>
        <p className="muted mt-1 max-w-3xl text-sm">
          Saved searches pull adverts from every board you&apos;ve configured, merge the copies of
          one advert posted to several, and score each one on arrival. Every job gets two scores.{" "}
          <strong>Professional Match</strong> is how well you actually fit, based on your combined
          profile. <strong>CV Match</strong> is how well the recommended CV communicates that fit.
          A gap between them means you are qualified but your CV is not saying so.
        </p>
      </header>
      <JobsScreen />
    </div>
  );
}
