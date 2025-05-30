import { Hono } from 'hono';
import { verifySignature } from './utils/verify-sign';

const app = new Hono();

// Helper function to send message to Discord
async function sendToDiscord(webhookUrl: string, embed: any) {
	try {
		await fetch(webhookUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				embeds: [embed],
			}),
		});
	} catch (error) {
		console.error('Error sending to Discord:', error);
	}
}

// Format push event
function formatPushEvent(payload: any) {
	const commits = payload.commits || [];
	const branch = payload.ref.replace('refs/heads/', '');
	const pusher = payload.pusher.name;
	const repoName = payload.repository.name;
	const repoUrl = payload.repository.html_url;

	let description = `**${pusher}** pushed ${commits.length} commit(s) to \`${branch}\``;

	if (commits.length > 0) {
		description += '\n\n**Commits:**\n';
		commits.slice(0, 5).forEach((commit: any) => {
			const shortSha = commit.id.substring(0, 7);
			description += `• [\`${shortSha}\`](${commit.url}) ${commit.message.split('\n')[0]}\n`;
		});

		if (commits.length > 5) {
			description += `... and ${commits.length - 5} more commits`;
		}
	}

	return {
		title: `📤 Push to ${repoName}`,
		description,
		color: 0x28a745, // Green
		url: `${repoUrl}/compare/${payload.before.substring(0, 7)}...${payload.after.substring(0, 7)}`,
		timestamp: new Date().toISOString(),
		footer: {
			text: `Branch: ${branch}`,
		},
	};
}

// Format pull request event
function formatPullRequestEvent(payload: any) {
	const action = payload.action;
	const pr = payload.pull_request;
	const author = pr.user.login;
	const repoName = payload.repository.name;

	let color = 0x0366d6; // Blue
	let emoji = '🔀';

	if (action === 'opened') {
		color = 0x28a745; // Green
		emoji = '🆕';
	} else if (action === 'closed') {
		color = pr.merged ? 0x6f42c1 : 0xd73a49; // Purple if merged, Red if closed
		emoji = pr.merged ? '✅' : '❌';
	}

	const description = `**${author}** ${action} pull request #${pr.number}\n\n${
		pr.body ? pr.body.substring(0, 200) + (pr.body.length > 200 ? '...' : '') : 'No description provided'
	}`;

	return {
		title: `${emoji} Pull Request ${action} in ${repoName}`,
		description,
		color,
		url: pr.html_url,
		timestamp: new Date().toISOString(),
		fields: [
			{
				name: 'From → To',
				value: `\`${pr.head.ref}\` → \`${pr.base.ref}\``,
				inline: true,
			},
			{
				name: 'Changes',
				value: `+${pr.additions} -${pr.deletions}`,
				inline: true,
			},
		],
		footer: {
			text: `PR #${pr.number}`,
		},
	};
}

// Format issue comment event
function formatIssueCommentEvent(payload: any) {
	const action = payload.action;
	const comment = payload.comment;
	const issue = payload.issue;
	const author = comment.user.login;
	const repoName = payload.repository.name;

	const isPR = !!issue.pull_request;
	const emoji = isPR ? '💬' : '📝';
	const type = isPR ? 'Pull Request' : 'Issue';

	const description = `**${author}** ${action} a comment on ${type.toLowerCase()} #${issue.number}\n\n${comment.body.substring(0, 300)}${
		comment.body.length > 300 ? '...' : ''
	}`;

	return {
		title: `${emoji} Comment ${action} in ${repoName}`,
		description,
		color: 0x586069, // Gray
		url: comment.html_url,
		timestamp: new Date().toISOString(),
		footer: {
			text: `${type} #${issue.number}: ${issue.title}`,
		},
	};
}

// Format repository event (create/delete)
function formatRepositoryEvent(payload: any) {
	const action = payload.action;
	const repo = payload.repository;
	const sender = payload.sender.login;

	let emoji = '📁';
	let color = 0x0366d6;

	if (action === 'created') {
		emoji = '🆕';
		color = 0x28a745;
	} else if (action === 'deleted') {
		emoji = '🗑️';
		color = 0xd73a49;
	}

	return {
		title: `${emoji} Repository ${action}`,
		description: `**${sender}** ${action} repository **${repo.name}**${repo.description ? `\n\n${repo.description}` : ''}`,
		color,
		url: repo.html_url,
		timestamp: new Date().toISOString(),
		fields: repo.language
			? [
					{
						name: 'Language',
						value: repo.language,
						inline: true,
					},
			  ]
			: [],
	};
}

// Format branch/tag creation event
function formatCreateEvent(payload: any) {
	const refType = payload.ref_type;
	const ref = payload.ref;
	const sender = payload.sender.login;
	const repoName = payload.repository.name;

	const emoji = refType === 'branch' ? '🌿' : '🏷️';

	return {
		title: `${emoji} ${refType.charAt(0).toUpperCase() + refType.slice(1)} created in ${repoName}`,
		description: `**${sender}** created ${refType} \`${ref}\``,
		color: 0x28a745,
		url: payload.repository.html_url,
		timestamp: new Date().toISOString(),
	};
}

// Format release event
function formatReleaseEvent(payload: any) {
	const action = payload.action;
	const release = payload.release;
	const author = release.author.login;
	const repoName = payload.repository.name;

	return {
		title: `🚀 Release ${action} in ${repoName}`,
		description: `**${author}** ${action} release **${release.name || release.tag_name}**\n\n${
			release.body ? release.body.substring(0, 400) + (release.body.length > 400 ? '...' : '') : 'No release notes provided'
		}`,
		color: 0x0366d6,
		url: release.html_url,
		timestamp: new Date().toISOString(),
		fields: [
			{
				name: 'Tag',
				value: release.tag_name,
				inline: true,
			},
			{
				name: 'Prerelease',
				value: release.prerelease ? 'Yes' : 'No',
				inline: true,
			},
		],
	};
}

app.post('/github-webhook', async (c) => {
	// add simple secret key check here.
	const SECRET_KEY = (c.env as { SECRET_KEY?: string }).SECRET_KEY;
	if (!SECRET_KEY) {
		return c.json({ error: 'Missing SECRET_KEY environment variable' }, 500);
	}
	const secretKey = c.req.header('X-Hub-Signature-256');
	if (!(await verifySignature(SECRET_KEY, await c.req.text(), secretKey))) {
		return c.json({ error: 'Invalid secret key' }, 401);
	}

	try {
		// Parse the body as JSON after verification
		const rawBody = await c.req.text();
		const payload = JSON.parse(rawBody);
		const event = c.req.header('X-GitHub-Event');
		const DISCORD_WEBHOOK_URL = (c.env as { DISCORD_WEBHOOK_URL?: string }).DISCORD_WEBHOOK_URL;
		if (!DISCORD_WEBHOOK_URL) {
			return c.json({ error: 'Missing DISCORD_WEBHOOK_URL environment variable' }, 500);
		}

		if (!event) {
			return c.json({ error: 'Missing X-GitHub-Event header' }, 400);
		}

		let embed;

		switch (event) {
			case 'push':
				embed = formatPushEvent(payload);
				break;

			case 'pull_request':
				// Only handle opened, closed, and reopened actions
				if (['opened', 'closed', 'reopened'].includes(payload.action)) {
					embed = formatPullRequestEvent(payload);
				}
				break;

			case 'issue_comment':
				// Only handle created comments
				if (payload.action === 'created') {
					embed = formatIssueCommentEvent(payload);
				}
				break;

			case 'repository':
				if (['created', 'deleted'].includes(payload.action)) {
					embed = formatRepositoryEvent(payload);
				}
				break;

			case 'create':
				// Handle branch/tag creation
				embed = formatCreateEvent(payload);
				break;

			case 'release':
				if (['published', 'created'].includes(payload.action)) {
					embed = formatReleaseEvent(payload);
				}
				break;

			default:
				console.log(`Unhandled event: ${event}`);
				return c.json({ message: 'Event not supported' }, 200);
		}

		if (embed) {
			await sendToDiscord(DISCORD_WEBHOOK_URL, embed);
			return c.json({ message: 'Webhook processed successfully' }, 200);
		}

		return c.json({ message: 'No action taken' }, 200);
	} catch (error) {
		console.error('Error processing webhook:', error);
		return c.json({ error: 'Internal server error' }, 500);
	}
});

// Health check endpoint
app.get('/health', (c) => {
	return c.json({ status: 'OK', timestamp: new Date().toISOString() });
});

export default app;
