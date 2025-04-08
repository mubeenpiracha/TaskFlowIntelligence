// Script to test the OpenAI API connection and task detection
import OpenAI from 'openai';

async function testOpenAI() {
  // Check if we have the OpenAI API Key
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable is not set');
    return;
  }

  console.log('Testing OpenAI API connection and task detection capabilities...');

  try {
    // Initialize the OpenAI client
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // Test 1: Basic API connection
    console.log('\nTest 1: Testing basic API connection...');
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Say hello!" }
      ],
    });
    
    console.log('Response from OpenAI:', response.choices[0].message.content);
    console.log('✅ Basic API connection successful!');
    
    // Test 2: Task detection capability
    console.log('\nTest 2: Testing task detection capabilities...');
    
    const testMessages = [
      "Can you review the documentation by Friday?",
      "I'm going to the store later."
    ];
    
    console.log('Analyzing test messages for task detection...');
    
    for (const message of testMessages) {
      console.log(`\nAnalyzing: "${message}"`);
      
      const taskDetectionResponse = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024
        messages: [
          {
            role: "system",
            content: `You are an AI assistant that analyzes messages to determine if they contain tasks.
            A task is generally something that:
            1. Requires an action or completion of work
            2. May have a deadline or due date
            3. Is directed at the recipient (contains words like "you", "your", "please", etc.)
            4. Often uses imperative language or requests
            
            Respond in JSON format with the following structure:
            {
              "is_task": true/false,
              "confidence": 0.0-1.0,
              "deadline": "ISO date format or null",
              "deadline_text": "original deadline text from message",
              "urgency": 1-5 scale,
              "importance": 1-5 scale,
              "time_required_minutes": estimated time in minutes,
              "task_title": "extracted title for the task",
              "task_description": "longer description if available",
              "reasoning": "why you think this is or isn't a task"
            }`
          },
          {
            role: "user",
            content: message
          }
        ],
        response_format: { type: "json_object" }
      });
      
      const result = JSON.parse(taskDetectionResponse.choices[0].message.content);
      
      console.log(`Is Task: ${result.is_task ? 'YES ✅' : 'NO ❌'}`);
      console.log(`Confidence: ${result.confidence}`);
      if (result.is_task) {
        console.log(`Task Title: ${result.task_title}`);
        if (result.deadline) console.log(`Deadline: ${result.deadline} (${result.deadline_text})`);
        console.log(`Urgency: ${result.urgency}/5, Importance: ${result.importance}/5`);
        console.log(`Time Required: ~${result.time_required_minutes} minutes`);
      }
      console.log(`Reasoning: ${result.reasoning}`);
    }
    
    console.log('\n✅ Task detection capability test completed successfully!');
    console.log('\nAll tests completed successfully! ✨');
    
  } catch (error) {
    console.error('Error connecting to OpenAI:', error);
    if (error.response) {
      console.error('OpenAI API Error:', error.response.data);
    }
  }
}

// Run the test
testOpenAI();