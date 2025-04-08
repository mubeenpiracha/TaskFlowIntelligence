import OpenAI from "openai";
import { SlackMessage } from './slack';

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const MODEL = "gpt-4o";

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Task analysis response from OpenAI
 */
export interface TaskAnalysisResponse {
  is_task: boolean;
  confidence: number; // 0-1 score of confidence this is a task
  deadline?: string; // ISO date format or null
  deadline_text?: string; // Original deadline text from message
  urgency?: number; // 1-5 scale
  importance?: number; // 1-5 scale
  time_required_minutes?: number; // Estimated time in minutes
  task_title?: string; // Extracted title for the task
  task_description?: string; // Longer description if available
  reasoning: string; // Why OpenAI thinks this is or isn't a task
}

/**
 * Analyzes a Slack message to determine if it contains a task
 * Uses OpenAI to provide more accurate detection and extract task metadata
 * 
 * @param message The Slack message to analyze
 * @param userId The Slack user ID who would perform the task (to check for mentions)
 * @returns TaskAnalysisResponse with task details and confidence
 */
export async function analyzeMessageForTask(
  message: SlackMessage,
  userId: string
): Promise<TaskAnalysisResponse> {
  try {
    console.log(`OpenAI Analysis: Analyzing message from ${message.user || 'unknown user'}`);
    
    const userMention = `<@${userId}>`;
    const containsMention = message.text.includes(userMention);
    
    const prompt = `
You are analyzing a Slack message to determine if it contains a task that needs to be completed by a specific user.

Slack message: "${message.text}"

User ID to check if they are mentioned: "${userId}"
User mention format in Slack: "<@${userId}>"
Is the user directly mentioned in the message? ${containsMention ? "Yes" : "No"}

Please analyze this message and determine:
1. Is this message assigning a task to the user? (true/false)
2. What confidence do you have in this assessment? (0.0-1.0)
3. If it's a task, extract these details:
   - A concise task title (1-5 words)
   - A deadline if mentioned (in ISO format: YYYY-MM-DD and original text)
   - Urgency level (1-5 scale, where 5 is most urgent)
   - Importance level (1-5 scale, where 5 is most important)
   - Estimated time required in minutes (a reasonable guess based on the described task)
   - Task description (a cleaned-up version of the original message)
4. Provide a brief reasoning for your determination

IMPORTANT CONSIDERATIONS:
- Messages with direct mentions and action verbs are likely tasks
- Messages with words like "please", "can you", "need", "by tomorrow", "deadline", "asap" are likely tasks
- Just because someone is mentioned doesn't necessarily mean it's a task
- Questions to the user are not usually tasks
- Information sharing without requested action is not a task
- A task requires some action to be taken by the recipient
- Casual conversation is not a task

Respond with ONLY a valid JSON object with these fields:
{
  "is_task": boolean,
  "confidence": number between 0 and 1,
  "deadline": string in ISO format (YYYY-MM-DD) or null,
  "deadline_text": string or null,
  "urgency": number from 1-5 or null,
  "importance": number from 1-5 or null,
  "time_required_minutes": number or null,
  "task_title": string or null,
  "task_description": string or null,
  "reasoning": string
}`;

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    // Parse the response
    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    // Parse and validate the result
    const result = JSON.parse(content) as TaskAnalysisResponse;
    console.log(`OpenAI Result: is_task=${result.is_task}, confidence=${result.confidence}`);
    
    // Apply default values for missing fields
    return {
      is_task: result.is_task === true,
      confidence: Math.max(0, Math.min(1, result.confidence || 0)),
      deadline: result.deadline || undefined,
      deadline_text: result.deadline_text || undefined,
      urgency: result.urgency || undefined,
      importance: result.importance || undefined,
      time_required_minutes: result.time_required_minutes || undefined,
      task_title: result.task_title || undefined,
      task_description: result.task_description || undefined,
      reasoning: result.reasoning || "No reasoning provided"
    };
    
  } catch (error) {
    console.error("Error analyzing message with OpenAI:", error);
    
    // Return a default response if OpenAI fails
    return {
      is_task: false,
      confidence: 0,
      reasoning: "Error: Could not analyze message with AI. Falling back to rule-based detection."
    };
  }
}

/**
 * Extract key details from a task message to prepare task creation
 * Can be used to enhance/correct details after a user confirms it's a task
 * 
 * @param message Slack message text to analyze
 * @param existingAnalysis Optional previous analysis to refine
 * @returns Enhanced task details
 */
export async function extractTaskDetails(
  message: string,
  existingAnalysis?: Partial<TaskAnalysisResponse>
): Promise<TaskAnalysisResponse> {
  try {
    const prompt = `
You are a task extraction assistant. Your job is to extract detailed information about a task from a Slack message.

Slack message: "${message}"

${existingAnalysis ? `
Previous analysis detected:
- Is task: ${existingAnalysis.is_task}
- Confidence: ${existingAnalysis.confidence}
- Title: ${existingAnalysis.task_title || 'Not detected'}
- Deadline: ${existingAnalysis.deadline || 'Not detected'}
- Urgency: ${existingAnalysis.urgency || 'Not detected'}
- Importance: ${existingAnalysis.importance || 'Not detected'}
- Time required: ${existingAnalysis.time_required_minutes || 'Not detected'} minutes
` : ''}

Please provide a refined, detailed analysis of this task with:
1. A clear, concise task title (1-5 words)
2. Any deadline mentioned (in ISO format: YYYY-MM-DD)
3. Urgency level (1-5 scale, where 5 is most urgent)
4. Importance level (1-5 scale, where 5 is most important)
5. Estimated time required in minutes
6. Task description (a clean version of what needs to be done)

Respond with ONLY a valid JSON object with these fields:
{
  "is_task": true,
  "confidence": 1.0,
  "deadline": string in ISO format (YYYY-MM-DD) or null,
  "deadline_text": string or null,
  "urgency": number from 1-5,
  "importance": number from 1-5,
  "time_required_minutes": number,
  "task_title": string,
  "task_description": string,
  "reasoning": string explaining your analysis
}`;

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    // Parse the response
    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    // Parse and validate the result
    const result = JSON.parse(content) as TaskAnalysisResponse;
    console.log(`OpenAI Task Details Extraction: title=${result.task_title}, urgency=${result.urgency}, importance=${result.importance}`);
    
    // Apply default values for missing fields
    return {
      is_task: true,
      confidence: 1.0,
      deadline: result.deadline || undefined,
      deadline_text: result.deadline_text || undefined,
      urgency: result.urgency || 3,
      importance: result.importance || 3,
      time_required_minutes: result.time_required_minutes || 30,
      task_title: result.task_title || "Untitled Task",
      task_description: result.task_description || message,
      reasoning: result.reasoning || "Task details extracted from message"
    };
    
  } catch (error) {
    console.error("Error extracting task details with OpenAI:", error);
    
    // Return a default response if OpenAI fails
    return {
      is_task: true,
      confidence: 1.0,
      task_title: existingAnalysis?.task_title || "Untitled Task",
      urgency: existingAnalysis?.urgency || 3,
      importance: existingAnalysis?.importance || 3,
      time_required_minutes: existingAnalysis?.time_required_minutes || 30,
      task_description: message,
      reasoning: "Error: Could not analyze message with AI. Using default values."
    };
  }
}