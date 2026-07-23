# Production delivery requirements

This repository is a production application. For every implementation task:

1. Preserve unrelated user changes and inspect the final diff before staging.
2. Run the complete automated test suite, TypeScript checks, lint checks available in the project, and the production build.
3. Fix every failure before publishing.
4. Stage only the completed task's files and commit them with a clear, descriptive message.
5. Push the completed commit to `origin/main` without waiting for a separate user reminder.
6. Confirm the local branch matches `origin/main`.
7. Confirm the Vercel status for the exact pushed commit reaches `success`.
8. If Vercel fails, inspect the failure, fix it, rerun validation, commit, push, and verify again.
9. Do not report the task complete while changes are uncommitted, unpushed, or not successfully deployed.

Do not create background file watchers or commit unrelated work. Automatic delivery means Codex performs the validated commit, push, and deployment verification as the final phase of each completed task.
