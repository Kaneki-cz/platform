import asyncio
import socket

asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def main():
    print(socket.getaddrinfo("generativelanguage.googleapis.com", 443, socket.AF_INET, socket.SOCK_STREAM))


asyncio.run(main())
