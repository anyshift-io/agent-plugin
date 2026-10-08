# Agent instructions

## Manually validating pull requests

Pull requests do not start validation automatically, including pull requests from forks. A new commit requires a fresh successful manual run of the required `validate` check.

- **GitHub UI:** Open **Actions**, select the workflow, choose **Run workflow**, select the pull request branch in this repository, provide any required inputs, and start the run.
- **GitHub CLI:** For a pull request branch in this repository, agents can run the workflow on that branch:

  ```sh
  gh workflow run <workflow-file> --ref <pr-branch> --repo anyshift-io/agent-plugin -f name=value
  ```

Replace `<workflow-file>` and `<pr-branch>` with the workflow path and current PR branch. Add `-f name=value` for each required workflow input. Confirm the `validate` check has passed on the exact PR head before merging.

- **Fork pull requests:** Dispatch the trusted workflow from `main` with the PR number:

  ```sh
  gh workflow run validate.yml --ref main --repo anyshift-io/agent-plugin -f pr_number=<number>
  ```

  The workflow resolves the open PR's head repository and immutable commit SHA, validates that exact fork commit on a GitHub-hosted runner with read-only contents access and no persisted checkout credential, then a separate trusted job publishes the `validate` status. The publisher has only `statuses: write`, does not check out or execute PR code, and runs even when validation fails so the required status cannot remain pending. This workflow does not publish packages or releases.
