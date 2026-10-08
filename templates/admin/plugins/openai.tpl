<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 col-md-8 px-0 mb-4" tabindex="0">
			<form role="form" class="openai-settings">
				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">{{tx("openai:admin.general")}}</h5>

					<div class="mb-3">
						<label class="form-label" for="apikey">{{tx("openai:admin.api-key")}}</label>
						<input type="text" id="apikey" name="apikey" title="API Key" class="form-control">
						<p class="form-text">
							{{tx("openai:admin.api-key-help")}}
						</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="apiBaseUrl">{{tx("openai:admin.api-base-url")}}</label>
						<input type="text" id="apiBaseUrl" name="apiBaseUrl" title="API Base Url" class="form-control">
						<p class="form-text">
							{{tx("openai:admin.api-base-url-help")}}
						</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="chatgpt-username">{{tx("openai:admin.chatgpt-username")}}</label>
						<input type="text" id="chatgpt-username" name="chatgpt-username" title="ChatGPT Username" class="form-control">
						<p class="form-text">
							<a href="{config.relative_path}/admin/manage/users">{{tx("openai:admin.create-user")}}</a> {{tx("openai:admin.chatgpt-username-help")}}
						</p>
					</div>

					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="enablePrivateMessages" name="enablePrivateMessages">
						<label for="enablePrivateMessages" class="form-check-label">{{tx("openai:admin.enable-private-messages")}}</label>
						<p class="form-text">
							{{tx("openai:admin.enable-private-messages-help")}}
						</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="model">{{tx("openai:admin.model")}}</label>
						<input type="text" class="form-control" id="model" name="model" title="Model" list="model-suggestions" placeholder="e.g. gpt-4o, gemini-2.5-pro">
						<datalist id="model-suggestions">
							<option value="gpt-3.5-turbo">
							<option value="gpt-4o-mini">
							<option value="gpt-4o">
							<option value="gpt-4-turbo">
							<option value="gpt-4">
							<option value="gpt-4.1-mini">
							<option value="gpt-4.1">
							<option value="gemini-2.5-pro">
							<option value="gemini-2.5-flash">
							<option value="gemini-2.5-flash-lite">
							<option value="gemini-3-flash">
							<option value="gemini-3.1-flash-lite">
							<option value="gemini-2.0-flash">
							<option value="gemma-3-27b-it">
							<option value="gemma-3-12b-it">
							<option value="gemma-3-4b-it">
							<option value="gemma-4-31b-it">
							<option value="gemma-4-26b-a4b-it">
							<option value="gemma-4-e4b-it">
							<option value="gemma-4-e2b-it">
						</datalist>
						<p class="form-text">
							{{tx("openai:admin.model-help")}}
						</p>
					</div>
					<div class="mb-3">
						<label class="form-label" for="systemPrompt">{{tx("openai:admin.system-prompt")}}</label>
						<textarea class="form-control" id="systemPrompt" name="systemPrompt" title="System prompt" placeholder="{{tx("openai:admin.system-prompt-placeholder")}}" rows="8"></textarea>
					</div>
				</div>

				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">{{tx("openai:admin.mention-settings")}}</h5>
					<p class="form-text mb-3">
						{{tx("openai:admin.mention-settings-help")}}
					</p>

					<div class="mb-3">
						<label class="form-label" for="mentionApiKey">{{tx("openai:admin.mention-api-key")}}</label>
						<input type="text" id="mentionApiKey" name="mentionApiKey" title="Mention API Key" class="form-control">
						<p class="form-text">
							{{tx("openai:admin.mention-api-key-help")}}
						</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="mentionApiBaseUrl">{{tx("openai:admin.mention-api-base-url")}}</label>
						<input type="text" id="mentionApiBaseUrl" name="mentionApiBaseUrl" title="Mention API Base URL" class="form-control">
						<p class="form-text">
							{{tx("openai:admin.mention-api-base-url-help")}}
						</p>
					</div>
				</div>

				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">{{tx("openai:admin.topic-summary")}}</h5>

					<div class="mb-3">
						<label class="form-label" for="summarySystemPrompt">{{tx("openai:admin.summary-system-prompt")}}</label>
						<textarea class="form-control" id="summarySystemPrompt" name="summarySystemPrompt" title="Summary system prompt" placeholder="{{tx("openai:admin.summary-system-prompt-placeholder")}}" rows="6"></textarea>
						<p class="form-text">
							{{tx("openai:admin.summary-system-prompt-help")}}
						</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="summaryFinalSystemPrompt">{{tx("openai:admin.summary-final-system-prompt")}}</label>
						<textarea class="form-control" id="summaryFinalSystemPrompt" name="summaryFinalSystemPrompt" title="Final summary system prompt" placeholder="{{tx("openai:admin.summary-final-system-prompt-placeholder")}}" rows="6"></textarea>
						<p class="form-text">
							{{tx("openai:admin.summary-final-system-prompt-help")}}
						</p>
					</div>

					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="summaryRenderMarkdown" name="summaryRenderMarkdown">
						<label for="summaryRenderMarkdown" class="form-check-label">{{tx("openai:admin.summary-render-markdown")}}</label>
						<p class="form-text">
							{{tx("openai:admin.summary-render-markdown-help")}}
						</p>
					</div>

					<div class="mb-3 mt-3">
						<label class="form-label" for="summaryKeyMode">{{tx("openai:admin.summary-key-mode")}}</label>
						<select class="form-select" id="summaryKeyMode" name="summaryKeyMode">
							<option value="owner">{{tx("openai:admin.summary-key-owner")}}</option>
							<option value="user">{{tx("openai:admin.summary-key-user")}}</option>
							<option value="both">{{tx("openai:admin.summary-key-both")}}</option>
						</select>
						<p class="form-text">
							{{tx("openai:admin.summary-key-mode-help")}}
						</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="summaryHourlyLimit">{{tx("openai:admin.summary-hourly-limit")}}</label>
						<input type="number" min="0" id="summaryHourlyLimit" name="summaryHourlyLimit" title="Summary requests per hour" class="form-control" placeholder="20">
						<p class="form-text">
							{{tx("openai:admin.summary-hourly-limit-help")}}
						</p>
					</div>

					<div class="form-check form-switch">
						<input type="checkbox" class="form-check-input" id="summaryDisableCustomPrompt" name="summaryDisableCustomPrompt">
						<label for="summaryDisableCustomPrompt" class="form-check-label">{{tx("openai:admin.summary-disable-custom-prompt")}}</label>
						<p class="form-text">
							{{tx("openai:admin.summary-disable-custom-prompt-help")}}
						</p>
					</div>
				</div>

				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">{{tx("openai:admin.restrictions")}}</h5>
					<p class="form-text mb-3">
						{{tx("openai:admin.restrictions-help")}}
					</p>

					<div class="mb-3">
						<label class="form-label" for="minimumReputation">{{tx("openai:admin.minimum-reputation")}}</label>
						<input type="text" id="minimumReputation" name="minimumReputation" title="Minimum Reputation" class="form-control">
						<p class="form-text">
							{{tx("openai:admin.minimum-reputation-help")}}
						</p>
					</div>
					<div class="mb-3">
						<label class="form-label" form="allowedGroups">{{tx("openai:admin.allowed-groups")}}</label>
						<select class="form-select" multiple id="allowedGroups" name="allowedGroups" size="10">
							{{{ each groups }}}
							<option value="{./displayName}">{./displayName}</option>
							{{{ end }}}
						</select>
						<p class="form-text">
							{{tx("openai:admin.allowed-groups-help")}}
						</p>
					</div>
				</div>

				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">{{tx("openai:admin.mention-restrictions")}}</h5>
					<p class="form-text mb-3">
						{{tx("openai:admin.mention-restrictions-help")}}
					</p>

					<div class="mb-3">
						<label class="form-label" for="mentionMinimumReputation">{{tx("openai:admin.mention-minimum-reputation")}}</label>
						<input type="text" id="mentionMinimumReputation" name="mentionMinimumReputation" title="Mention Minimum Reputation" class="form-control">
						<p class="form-text">
							{{tx("openai:admin.mention-minimum-reputation-help")}}
						</p>
					</div>
					<div class="mb-3">
						<label class="form-label" form="mentionAllowedGroups">{{tx("openai:admin.mention-allowed-groups")}}</label>
						<select class="form-select" multiple id="mentionAllowedGroups" name="mentionAllowedGroups" size="10">
							{{{ each groups }}}
							<option value="{./displayName}">{./displayName}</option>
							{{{ end }}}
						</select>
						<p class="form-text">
							{{tx("openai:admin.mention-allowed-groups-help")}}
						</p>
					</div>
				</div>

				<div class="">
					<h5 class="fw-bold tracking-tight settings-header">{{tx("openai:admin.pm-restrictions")}}</h5>
					<p class="form-text mb-3">
						{{tx("openai:admin.pm-restrictions-help")}}
					</p>

					<div class="mb-3">
						<label class="form-label" for="pmApiKey">{{tx("openai:admin.pm-api-key")}}</label>
						<input type="text" id="pmApiKey" name="pmApiKey" title="Chat API Key" class="form-control">
						<p class="form-text">
							{{tx("openai:admin.pm-api-key-help")}}
						</p>
					</div>
					<div class="mb-3">
						<label class="form-label" for="pmApiBaseUrl">{{tx("openai:admin.pm-api-base-url")}}</label>
						<input type="text" id="pmApiBaseUrl" name="pmApiBaseUrl" title="Chat API Base URL" class="form-control">
						<p class="form-text">
							{{tx("openai:admin.pm-api-base-url-help")}}
						</p>
					</div>

					<div class="mb-3">
						<label class="form-label" for="pmMinimumReputation">{{tx("openai:admin.pm-minimum-reputation")}}</label>
						<input type="text" id="pmMinimumReputation" name="pmMinimumReputation" title="Chat Minimum Reputation" class="form-control">
						<p class="form-text">
							{{tx("openai:admin.pm-minimum-reputation-help")}}
						</p>
					</div>
					<div class="mb-3">
						<label class="form-label" form="pmAllowedGroups">{{tx("openai:admin.pm-allowed-groups")}}</label>
						<select class="form-select" multiple id="pmAllowedGroups" name="pmAllowedGroups" size="10">
							{{{ each groups }}}
							<option value="{./displayName}">{./displayName}</option>
							{{{ end }}}
						</select>
						<p class="form-text">
							{{tx("openai:admin.pm-allowed-groups-help")}}
						</p>
					</div>
					<div class="mb-3">
						<label class="form-label" for="pmNoPermissionMessage">{{tx("openai:admin.pm-no-permission-message")}}</label>
						<input type="text" id="pmNoPermissionMessage" name="pmNoPermissionMessage" title="No Permission Message" class="form-control" placeholder="{{tx("openai:no-permission-to-chat")}}">
						<p class="form-text">
							{{tx("openai:admin.pm-no-permission-message-help")}}
						</p>
					</div>
				</div>
			</form>
		</div>

		<!-- IMPORT admin/partials/settings/toc.tpl -->
	</div>
</div>
