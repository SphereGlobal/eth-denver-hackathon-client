"use client";

import axios from "axios";
import { useState } from "react";
import * as React from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

enum ChatRoles {
  Agent = "agent",
  User = "user",
}
interface Transaction {
  amount: number;
  approval: string;
  chain: string;
  from_address: string;
  hash: string | null;
  intent: string;
  quote: string;
  signature: string;
  to_address: string;
  token: string;
}

interface Message {
  id?: string;
  role: ChatRoles;
  content: string;
}

export default function Home() {
  const [messages, setMessages] = React.useState<Message[]>([
    {
      role: ChatRoles.Agent,
      content: "Hi, how can I help you today?",
    },
  ]);
  const [input, setInput] = React.useState("");
  const inputLength = input.trim().length;
  const [quote, setQuote] = useState("");
  const [loading, setLoading] = useState(false);
  const loadingMessageId = "loading-message";
  const messagesEndRef = React.useRef<null | HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const addMessage = (newMessage: Message) => {
    setMessages((prevMessages) => [...prevMessages, newMessage]);
    // Scroll to bottom after state update
    setTimeout(() => scrollToBottom(), 0); // Timeout ensures scrolling occurs after DOM update
  };

  const updateLoadingMessage = (content: string) => {
    setMessages((prevMessages) =>
      prevMessages.map((msg) =>
        msg.id === loadingMessageId ? { ...msg, content, id: undefined } : msg
      )
    );

    setTimeout(() => scrollToBottom(), 0);
  };

  const removeLoadingMessage = () => {
    setMessages((prevMessages) =>
      prevMessages.filter((message) => message.id !== loadingMessageId)
    );
  };

  async function getTransaction() {
    try {
      const res = await axios.get("http://127.0.0.1:5000/transaction");
      return res.data.data;
    } catch (err: any) {
      alert("Error: " + err?.message);
      console.error(err);
    }
  }

  async function sendIntent() {
    try {
      const res = await axios.post("http://127.0.0.1:5000/intent", {
        intent: input,
      });
      const formattedQuote = await explainQuoteWithGpt(res.data.data);
      setQuote(formattedQuote);
      updateLoadingMessage(formattedQuote);
    } catch (err: any) {
      alert("Error: " + err?.message);
      console.error(err);
    }
  }

  async function handleSubmit(event: any) {
    event.preventDefault();
    if (!messages.find((message) => message.id === loadingMessageId)) {
      addMessage({
        role: ChatRoles.Agent,
        content: "",
        id: loadingMessageId,
      });
    }
    try {
      setLoading(true);
      if (!quote) {
        await sendIntent();
      } else if (quote) {
        await approveTransaction();
      }
    } catch (err: any) {
      alert("Error: " + err?.message);
      removeLoadingMessage();
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function clearTransaction() {
    try {
      await axios.post("http://127.0.0.1:5000/clear");
    } catch (err: any) {
      alert("Error: " + err?.message);
      console.error(err);
    }
  }

  async function approveTransaction() {
    try {
      setLoading(true);
      const approvalMessage = await extractApprovalFromGpt(input); // it will return "yes" if the user wants to proceed with the transaction or a denial message if the user doesn't want to proceed with the transaction or if the intent is unclear
      console.log(approvalMessage);
      if (approvalMessage.toLowerCase().replace(/[^a-zA-Z]/g, "") !== "yes") {
        return updateLoadingMessage(approvalMessage);
      }
      await axios.post("http://127.0.0.1:5000/intent/approve");

      // poll for transaction until we have the hash
      const transaction = (await pollWithTimeout(
        getTransaction,
        (data) => data && data.hash,
        120000, // 2 minute timeout
        2000 // 2 seconds interval
      )) as Transaction;
      if (!transaction.hash) {
        throw new Error("Payment could not be completed, please try again");
      }
      const formattedResult = await explainResultWithGpt(transaction);
      updateLoadingMessage(formattedResult);
    } catch (err: any) {
      alert("Error: " + err?.message);
      console.error(err);
    } finally {
      setLoading(false);
      setQuote("");
      await clearTransaction();
    }
  }

  async function explainQuoteWithGpt(quote: string) {
    const res = await axios.request({
      method: "post",
      maxBodyLength: Infinity,
      url: "https://api.openai.com/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
      },
      data: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant.",
          },
          {
            role: "user",
            content: `create a one-sentence message explaining to the user this payment quote and asking if he desires to accept it. Use simple words but include addresses, respond with just the message and nothing else. If you don't receive any quote or receive a message saying that there aren't enough funds, please inform that the transaction can't proceed: '${quote}'`,
          },
        ],
      }),
    });

    return res.data.choices[0].message.content;
  }

  async function explainResultWithGpt(transaction: Transaction) {
    const res = await axios.request({
      method: "post",
      maxBodyLength: Infinity,
      url: "https://api.openai.com/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
      },
      data: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant.",
          },
          {
            role: "user",
            content: `create a one-sentence message explaining the details of the payment to the user using this data ${JSON.stringify(
              transaction
            )} and show the following two hashes in the message:
                  payment: ${transaction.hash} (polygon transaction)
                  approval: ${
                    transaction.approval
                  } (sphere one transaction that allowed the payment)`,
          },
        ],
      }),
    });

    return res.data.choices[0].message.content;
  }

  async function extractApprovalFromGpt(message: string) {
    const res = await axios.request({
      method: "post",
      maxBodyLength: Infinity,
      url: "https://api.openai.com/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
      },
      data: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant.",
          },
          {
            role: "user",
            content: `Given the user's message, your task is to determine if they intend to approve a transaction. If the message conveys a positive sentiment or agreement, even if expressed in informal or enthusiastic language, interpret it as a clear intent to approve. Respond with 'yes' if you identify such intent. If the message clearly expresses a desire not to proceed with the transaction, respond with a message indicating that the transaction will not be executed, and encourage them to let you know if they wish to attempt another transaction in the future. If the message is ambiguous, unclear, or does not directly address the approval of the transaction, respond by stating that the intent couldn't be inferred and, as a precaution, the transaction will not be processed. Your responses should remain focused on the context of approving or not approving a transaction, without diverting to unrelated assistance. Avoid offering assistance for actions unrelated to making transactions. Use the user's message to guide your response: '${message}'`,
          },
        ],
      }),
    });

    return res.data.choices[0].message.content;
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-8 sm:p-20">
      <Card className="w-full sm:w-3/4 shadow-xl">
        <CardHeader className="flex items-center">
          <div className="flex items-center rounded-full w-16 sm:w-24 h-16 sm:h-24 my-8">
            <img
              src="https://firebasestorage.googleapis.com/v0/b/spheremvp.appspot.com/o/og%2Flanding%2Fsphereone_logo.png?alt=media&token=8f3c2ff5-94ba-409a-88c0-139b0a16a06a"
              alt=""
            />
          </div>
          <h1 className="text-lg sm:text-2xl font-bold mb-2">SphereOne</h1>
          <h2 className="text-md sm:text-xl mx-4">
            Transfer anything to anyone, anywhere, instantly
          </h2>
        </CardHeader>
        <CardContent className="space-y-4 max-h-[40vh] overflow-y-auto">
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                "flex w-max max-w-[75%] flex-col gap-2 rounded-lg px-3 py-2 text-sm text-wrap break-words",
                message.role === ChatRoles.User
                  ? "ml-auto text-primary-foreground bg-blue-300"
                  : "bg-gray-300",
                message?.id === loadingMessageId
                  ? "animate-pulse w-[75%] h-24"
                  : ""
              )}
            >
              {message.content}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </CardContent>
        <CardFooter>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (inputLength === 0) return;
              addMessage({ role: ChatRoles.User, content: input });
              setInput("");
              handleSubmit(event);
            }}
            className="flex w-full items-center space-x-2"
          >
            <Input
              id="intent"
              type="text"
              placeholder="Send 0.01 MATIC to user email@hotmail.com in chain: POLYGON"
              className="flex-1"
              autoComplete="off"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <Button
              type="submit"
              name="intent"
              size="icon"
              disabled={inputLength === 0 || loading}
            >
              <Send className="h-4 w-4" />
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </CardFooter>
      </Card>
    </main>
  );
}

const pollWithTimeout = async (
  pollingFunction: () => Promise<any>,
  conditionCheck: (data: any) => boolean,
  timeout: number = 60000,
  interval: number = 2000
) => {
  let timeoutId: NodeJS.Timeout;
  let intervalId: NodeJS.Timeout;

  return new Promise((resolve, reject) => {
    // Start polling
    intervalId = setInterval(async () => {
      try {
        const data = await pollingFunction();
        if (conditionCheck(data)) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);
          resolve(data);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        reject(error);
      }
    }, interval);

    // Set timeout
    timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error("Polling timed out"));
    }, timeout);
  });
};
