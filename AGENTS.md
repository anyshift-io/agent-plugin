# Agent instructions

## Manually validating pull requests

Pull requests do not start validation automatically, including pull requests from forks. Every new commit needs a new successful run of the required `validate` check on the exact PR head.

Always dispatch the trusted workflow from `main` with the PR number. This applies to branches in this repository and to forks. A dispatch on the PR branch itself does not attach `validate` to the pull request.

- **GitHub UI:** Open **Actions**, select **Validate Agent Plugin**, choose **Run workflow**, keep the `main` branch, enter the PR number in `pr_number`, and start the run.
- **GitHub CLI:**

  ```sh
  gh workflow run validate.yml --ref main --repo anyshift-io/agent-plugin -f pr_number=<number>
  ```

The workflow resolves the open PR's immutable head SHA and merge result. It validates the merge result on a GitHub-hosted runner with read-only contents access and no persisted checkout credential. A separate trusted job then creates and completes the `validate` check run on the PR head. That job has only `checks: write`, `actions: read`, and `pull-requests: read`, and does not check out or execute PR code. Only the newest dispatch for a PR can complete the check. The workflow does not publish packages or releases.
